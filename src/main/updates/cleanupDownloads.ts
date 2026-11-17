import { t } from '../../shared/i18n/index.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, readdir, rm, mkdir, mkdtemp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { UpdateManifest } from '../../shared/updates.ts';
import { atomicJson, exists, readJson } from '../../../bundled/update-helper/protocol.mjs';
import { maxArchiveBytes } from './manifest.ts';
import { newerInChannel } from './releasePolicy.ts';

interface Resume {
  fingerprint: string;
  bytes: number;
  version: string;
}
interface OwnedDownload {
  directory: string;
  owner: { schema: number; id: string; pid: number; resume?: Resume };
  bytes: number;
  modified: number;
}
const operations = new Map<string, Promise<void>>();
function exclusive<T>(root: string, action: () => Promise<T>) {
  const result = (operations.get(root) ?? Promise.resolve()).then(action);
  const settled = result.then(
    () => {},
    () => {},
  );
  operations.set(root, settled);
  void settled.then(() => {
    if (operations.get(root) === settled) operations.delete(root);
  });
  return result;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}
async function inspectOwnedDownload(directory: string): Promise<OwnedDownload | undefined> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
    return;
  const names = await readdir(directory);
  if (
    !names.includes('owner.json') ||
    names.some((n) => !['owner.json', 'package.zip'].includes(n))
  )
    return;
  let bytes = 0;
  for (const name of names) {
    const child = await lstat(join(directory, name));
    if (!child.isFile() || child.isSymbolicLink() || child.nlink !== 1) return;
    if (name === 'owner.json' && child.size > 4096) return;
    if (name === 'package.zip') bytes = child.size;
  }
  let owner;
  try {
    owner = await readJson(join(directory, 'owner.json'));
  } catch {
    return;
  }
  if (
    typeof owner.schema !== 'number' ||
    ![1, 2].includes(owner.schema) ||
    typeof owner.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(owner.id) ||
    !Number.isSafeInteger(owner.pid) ||
    Number(owner.pid) < 1
  )
    return;
  let resume: Resume | undefined;
  if (owner.schema === 2) {
    const value = owner.resume as Partial<Resume> | undefined;
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      !Number.isSafeInteger(value.bytes) ||
      Number(value.bytes) < 1 ||
      Number(value.bytes) > maxArchiveBytes ||
      typeof value.version !== 'string' ||
      value.version.length > 80
    )
      return;
    resume = value as Resume;
  }
  return {
    directory,
    bytes,
    modified: (await lstat(join(directory, 'owner.json'))).mtimeMs,
    owner: { schema: Number(owner.schema), id: owner.id, pid: Number(owner.pid), resume },
  };
}
async function ownedDownload(directory: string) {
  try {
    return await inspectOwnedDownload(directory);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}
async function directories(root: string) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error(t('error.cleanupDownloads.theDownloadsFolderIsRedirected'));
  return (await readdir(root)).filter((name) => /^download-[A-Za-z0-9]{6}$/.test(name));
}
function resumable(item: OwnedDownload) {
  return !!item.owner.resume && item.bytes > 0 && item.bytes <= item.owner.resume.bytes;
}

/** Keep at most one interrupted download across restarts; never remove unknown files/live work. */
export async function cleanupDownloads(root: string, currentVersion?: string) {
  return exclusive(root, () => cleanupDownloadsOnce(root, currentVersion));
}
async function cleanupDownloadsOnce(root: string, currentVersion?: string) {
  if (!(await exists(root))) return;
  const pending: OwnedDownload[] = [];
  for (const name of await directories(root)) {
    const directory = join(root, name),
      item = await ownedDownload(directory);
    if (!item) {
      const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      // Do not race the owner marker being created by this startup's coordinator.
      if (
        info?.isDirectory() &&
        !info.isSymbolicLink() &&
        Date.now() - info.mtimeMs > 60_000 &&
        !(await readdir(directory)).length
      )
        await rm(directory, { recursive: true });
      continue;
    }
    if (alive(item.owner.pid)) continue;
    if (
      resumable(item) &&
      (!currentVersion || newerInChannel(currentVersion, item.owner.resume!.version))
    )
      pending.push(item);
    else await rm(directory, { recursive: true });
  }
  pending.sort((a, b) => b.modified - a.modified);
  for (const item of pending.slice(1)) await rm(item.directory, { recursive: true });
}

/** The complete signed manifest identity, rather than a filename alone, binds a saved prefix. */
export async function prepareDownload(root: string, manifest: UpdateManifest) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(t('error.cleanupDownloads.theDownloadsFolderIsRedirected'));
  const canonical = await realpath(root);
  return exclusive(canonical, () => prepareDownloadOnce(canonical, manifest));
}
async function prepareDownloadOnce(canonical: string, manifest: UpdateManifest) {
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  let selected: OwnedDownload | undefined;
  for (const name of await directories(canonical)) {
    const item = await ownedDownload(join(canonical, name));
    if (!item) continue;
    if (item.owner.pid !== process.pid && alive(item.owner.pid)) continue;
    if (!selected && resumable(item) && item.owner.resume!.fingerprint === fingerprint)
      selected = item;
    else await rm(item.directory, { recursive: true });
  }
  const id = selected?.owner.id ?? randomUUID();
  const directory = selected?.directory ?? (await mkdtemp(join(canonical, 'download-')));
  await atomicJson(join(directory, 'owner.json'), {
    schema: 2,
    id,
    pid: process.pid,
    resume: { fingerprint, bytes: manifest.archive.bytes, version: manifest.version },
  });
  return directory;
}

export async function releaseDownload(directory: string, keepPartial = false) {
  return exclusive(dirname(directory), () => releaseDownloadOnce(directory, keepPartial));
}
async function releaseDownloadOnce(directory: string, keepPartial: boolean) {
  const item = await ownedDownload(directory);
  if (!item || item.owner.pid !== process.pid)
    throw new Error(t('error.cleanupDownloads.theDownloadsFolderIsRedirected'));
  if (keepPartial && resumable(item)) {
    await atomicJson(join(directory, 'owner.json'), item.owner);
    return;
  }
  await rm(directory, { recursive: true });
}
