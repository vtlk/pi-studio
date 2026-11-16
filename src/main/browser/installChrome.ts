import { t } from '../../shared/i18n/index.ts';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson, isMissing } from '../storage/files.ts';
import { CHROME_VERSION, chromeArchive, chromeExecutable } from './browserVersions.ts';
import { powershellArguments, powershellLiteral, windowsPowershell } from '../pi/windowsShell.ts';
import {
  componentHash,
  componentState,
  downloadBrowserComponent,
  publishBrowserComponent,
} from './componentFiles.ts';

const execute = promisify(execFile);
const binaryLimit = 300 * 1024 ** 2;
export async function readChrome(root: string) {
  try {
    const state = await componentState(join(root, 'installed.json'));
    if (
      state.version !== CHROME_VERSION ||
      typeof state.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state.sha256)
    )
      throw new Error(t('error.installChrome.browserVersionMismatch'));
    const binary = join(root, chromeExecutable());
    if ((await componentHash(binary, binaryLimit)) !== state.sha256)
      throw new Error(t('error.installChrome.theBrowserWasModifiedReinstall'));
    return binary;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Private pinned Chrome for Testing; never connects to the user's browser or changes its profile. */
export async function installChrome(
  root: string,
  signal: AbortSignal,
  options: { arch?: string; request?: typeof fetch } = {},
) {
  const existing = await readChrome(root).catch(() => undefined);
  if (existing) return existing;
  const spec = chromeArchive(options.arch ?? process.arch);
  await mkdir(dirname(root), { recursive: true });
  const stage = join(dirname(root), `.chrome-install-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const archive = join(stage, 'chrome.zip'),
      unpacked = join(stage, 'unpacked');
    await downloadBrowserComponent(
      spec.url,
      archive,
      signal,
      { algorithm: 'sha256', encoding: 'hex', hash: spec.integrity, maxBytes: 200 * 1024 ** 2 },
      options.request,
    );
    await mkdir(unpacked);
    await execute(
      process.platform === 'win32' ? windowsPowershell() : '/usr/bin/ditto',
      process.platform === 'win32'
        ? powershellArguments(
            `Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(unpacked)}`,
          )
        : ['-xk', archive, unpacked],
      {
        signal,
        timeout: 60000,
        maxBuffer: 100000,
      },
    );
    const content = join(unpacked, spec.folder),
      binary = join(content, chromeExecutable());
    const version = await execute(binary, ['--version'], {
      signal,
      timeout: 10000,
      maxBuffer: 10000,
    });
    if (!version.stdout.includes(CHROME_VERSION))
      throw new Error(t('error.installChrome.browserVersionVerificationFailed'));
    await atomicJson(join(content, 'installed.json'), {
      version: CHROME_VERSION,
      sha256: await componentHash(binary, binaryLimit),
    });
    signal.throwIfAborted();
    return (
      (await publishBrowserComponent(content, root, readChrome)) ?? join(root, chromeExecutable())
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
