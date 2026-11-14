import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson, isMissing } from '../storage/files.ts';
import { AGENT_BROWSER_VERSION, browserArchive } from './browserVersions.ts';
import {
  componentHash,
  componentState,
  downloadBrowserComponent,
  publishBrowserComponent,
} from './componentFiles.ts';

const execute = promisify(execFile);
const limit = 32 * 1024 ** 2;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function readAgentBrowser(root: string) {
  try {
    const state = await componentState(join(root, 'installed.json'));
    if (
      state.version !== AGENT_BROWSER_VERSION ||
      typeof state.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state.sha256)
    )
      throw new Error('Не совпала версия компонента браузера.');
    const binary = join(root, 'agent-browser');
    if ((await componentHash(binary, limit)) !== state.sha256)
      throw new Error('Компонент браузера изменён. Переустановите его через настройки.');
    return binary;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Fixed official npm artifact, no npm scripts, no global installation or browser profile access. */
export async function installAgentBrowser(
  root: string,
  signal: AbortSignal,
  options: { arch?: string; request?: typeof fetch } = {},
) {
  const existing = await readAgentBrowser(root).catch(() => undefined);
  if (existing) return existing;
  const spec = browserArchive(options.arch ?? process.arch);
  await mkdir(dirname(root), { recursive: true });
  const stage = join(dirname(root), `.browser-install-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const archive = join(stage, 'package.tgz');
    await downloadBrowserComponent(
      spec.url,
      archive,
      signal,
      { algorithm: 'sha512', encoding: 'base64', hash: spec.integrity, maxBytes: limit },
      options.request,
    );
    const { stdout: entries } = await execute('/usr/bin/tar', ['-tzf', archive], {
      signal,
      maxBuffer: 100000,
    });
    const files = entries.trim().split('\n');
    if (files.some((path) => !path.startsWith('package/') || path.split('/').includes('..')))
      throw new Error('Некорректный архив компонента браузера.');
    const binaries = files.filter((path) => path.endsWith('/agent-browser'));
    if (binaries.length !== 1) throw new Error('В архиве отсутствует компонент браузера.');
    const { stdout: binary } = await execute('/usr/bin/tar', ['-xOzf', archive, binaries[0]], {
      signal,
      encoding: 'buffer',
      maxBuffer: limit,
    });
    if (
      binary.length < 4 ||
      !['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].includes(
        binary.subarray(0, 4).toString('hex'),
      )
    )
      throw new Error('Компонент браузера не является исполняемым файлом macOS.');
    const target = join(stage, 'agent-browser');
    await writeFile(target, binary, { mode: 0o700 });
    await chmod(target, 0o700);
    const version = await execute(target, ['--version'], {
      signal,
      timeout: 10000,
      maxBuffer: 10000,
    });
    if (version.stdout.trim() !== `agent-browser ${AGENT_BROWSER_VERSION}`)
      throw new Error('Версия компонента браузера не прошла проверку.');
    await rm(archive);
    await atomicJson(join(stage, 'installed.json'), {
      version: AGENT_BROWSER_VERSION,
      sha256: hash(binary),
    });
    signal.throwIfAborted();
    return (
      (await publishBrowserComponent(stage, root, readAgentBrowser)) ?? join(root, 'agent-browser')
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
