import { t } from '../../shared/i18n/index.ts';
import { constants } from 'node:fs';
import { open, lstat, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Publish a fully verified replacement; explicit reinstall repairs an incomplete/corrupt own cache. */
export async function publishBrowserComponent(
  stage: string,
  root: string,
  read: (root: string) => Promise<string | undefined>,
) {
  try {
    if ((await lstat(root)).isSymbolicLink())
      throw new Error(t('error.componentFiles.theComponentDirectoryMustNot'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const current = await read(root).catch(() => undefined);
  if (current) return current;
  await rm(root, { recursive: true, force: true });
  await rename(stage, root);
  return undefined;
}

export async function componentState(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384)
      throw new Error(t('error.componentFiles.invalidBrowserComponentRecord'));
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size)
      throw new Error(t('error.componentFiles.theComponentRecordChangedWhile'));
    const state = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as Record<
      string,
      unknown
    >;
    if (!state || typeof state !== 'object' || Array.isArray(state))
      throw new Error(t('error.componentFiles.invalidBrowserComponentRecord'));
    return state;
  } finally {
    await file.close();
  }
}

/** Bounded, nonblocking integrity check; special files never hold up component status. */
export async function componentHash(path: string, max: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 4 || before.size > max)
      throw new Error(t('error.componentFiles.invalidBrowserComponentFile'));
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - offset),
        offset,
      );
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await file.stat();
    if (
      offset !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error(t('error.componentFiles.theBrowserComponentChangedDuring'));
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}

export async function downloadBrowserComponent(
  url: string,
  path: string,
  signal: AbortSignal,
  expected: {
    algorithm: 'sha256' | 'sha512';
    encoding: 'hex' | 'base64';
    hash: string;
    maxBytes: number;
  },
  request: typeof fetch = fetch,
) {
  signal.throwIfAborted();
  const response = await request(url, {
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
  });
  if (!response.ok || !response.body)
    throw new Error(t('error.componentFiles.couldNotDownloadTheBrowser'));
  const reader = response.body.getReader(),
    hash = createHash(expected.algorithm);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let received = 0;
  try {
    file = await open(path, 'wx', 0o600);
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      signal.throwIfAborted();
      received += item.value.length;
      if (received > expected.maxBytes)
        throw new Error(t('error.componentFiles.unexpectedBrowserComponentSize'));
      hash.update(item.value);
      await file.writeFile(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    await file?.close();
  }
  if (hash.digest(expected.encoding) !== expected.hash)
    throw new Error(t('error.componentFiles.browserComponentChecksumMismatch'));
}
