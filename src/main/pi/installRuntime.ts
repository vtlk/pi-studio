import { t } from '../../shared/i18n/index.ts';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, symlink, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StartupState } from '../../shared/startup.ts';
import { checkPi } from './checkPi.ts';
import {
  PI_PACKAGE,
  PI_VERSION,
  NODE_VERSION,
  nodeArchives,
  windowsNodeX64Sha256,
} from './runtimeConfig.ts';
import { managedPiPath, piEnvironment } from './platform.ts';
import { powershellArguments, powershellLiteral, windowsPowershell } from './windowsShell.ts';

type Progress = (state: StartupState) => void;
export { command as runtimeCommand, downloadNode as downloadNodeRuntime };
export function validateRuntimeLock(manifest: unknown, lock: unknown) {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(t('installRuntime.piInstallationBundleIsDamaged'));
    return value as Record<string, unknown>;
  };
  const pkg = object(manifest),
    locked = object(lock),
    packages = object(locked.packages);
  if (
    pkg.version !== PI_VERSION ||
    object(pkg.dependencies)[PI_PACKAGE] !== PI_VERSION ||
    locked.lockfileVersion !== 3 ||
    locked.version !== PI_VERSION ||
    object(object(packages['']).dependencies)[PI_PACKAGE] !== PI_VERSION ||
    object(packages[`node_modules/${PI_PACKAGE}`]).version !== PI_VERSION
  )
    throw new Error(t('installRuntime.theInstallationBundleDoesNotMatchThe'));
  for (const item of Object.values(packages)) {
    const entry = object(item);
    if (entry.link) throw new Error(t('installRuntime.externalLinksAreNotAllowedInThe'));
    if (entry.resolved !== undefined) {
      const url = new URL(String(entry.resolved));
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'registry.npmjs.org' ||
        url.username ||
        url.password ||
        typeof entry.integrity !== 'string' ||
        !entry.integrity.startsWith('sha512-')
      )
        throw new Error(t('installRuntime.unsupportedPackageSourceInThePiInstallation'));
    }
  }
}
async function command(
  executable: string,
  args: string[],
  signal: AbortSignal,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      cwd: options.cwd,
      env: options.env,
      stdio: 'ignore',
      signal,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(t('installRuntime.piInstallationTimedOutTryAgain')));
    }, options.timeout ?? 180_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(t('installRuntime.couldNotInstallPiComponentsCheckYour')));
    });
  });
}
async function downloadNode(
  archive: string,
  arch: keyof typeof nodeArchives,
  signal: AbortSignal,
  update: Progress,
) {
  const response = await fetch(
    `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${process.platform === 'win32' ? `win-${arch}.zip` : `darwin-${arch}.tar.gz`}`,
    { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) },
  );
  if (!response.ok || !response.body)
    throw new Error(t('installRuntime.couldNotDownloadPiComponentsCheckYour'));
  const total = Number(response.headers.get('content-length'));
  const handle = await open(archive, 'wx', 0o600);
  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      signal.throwIfAborted();
      received += chunk.length;
      if (received > 150 * 1024 * 1024)
        throw new Error(t('installRuntime.unexpectedPiComponentSize'));
      hash.update(chunk);
      await handle.writeFile(chunk);
      update({
        phase: 'downloading',
        message: t('installRuntime.downloadingPiComponents'),
        ...(total > 0 ? { progress: Math.min(1, received / total) } : {}),
      });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close();
  }
  if (
    hash.digest('hex') !==
    (process.platform === 'win32' ? windowsNodeX64Sha256 : nodeArchives[arch])
  )
    throw new Error(t('installRuntime.downloadChecksumMismatchInstallationStopped'));
}
/** A private, pinned installation. No sudo, global npm install, shell profile changes or model calls. */
export async function installPiRuntime(
  root: string,
  bundled: string,
  update: Progress,
  signal: AbortSignal,
  arch: string = process.arch,
) {
  if ((arch !== 'arm64' && arch !== 'x64') || (process.platform === 'win32' && arch !== 'x64'))
    throw new Error(t('installRuntime.unsupportedPiInstallationArchitecture'));
  const manifest = JSON.parse(await readFile(join(bundled, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(bundled, 'package-lock.json'), 'utf8'));
  validateRuntimeLock(manifest, lock);
  try {
    await access(root);
    throw new Error(t('installRuntime.thePiInstallationDirectoryAlreadyExistsSelect'));
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  await mkdir(dirname(root), { recursive: true });
  const stage = join(dirname(root), `.pi-install-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const windows = process.platform === 'win32';
    const archive = join(stage, windows ? 'node.zip' : 'node.tar.gz');
    update({ phase: 'downloading', message: t('installRuntime.downloadingPiComponents') });
    await downloadNode(archive, arch, signal, update);
    update({ phase: 'installing', message: t('installRuntime.preparingPiComponents') });
    if (windows) {
      const unpacked = join(stage, 'unpacked');
      await command(
        windowsPowershell(),
        powershellArguments(
          `Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(unpacked)}`,
        ),
        signal,
      );
      await rename(join(unpacked, `node-v${NODE_VERSION}-win-${arch}`), join(stage, 'node'));
      await rm(unpacked, { recursive: true });
    } else {
      await mkdir(join(stage, 'node'));
      await command(
        '/usr/bin/tar',
        ['-xzf', archive, '-C', join(stage, 'node'), '--strip-components=1'],
        signal,
      );
    }
    await rm(archive);
    const packages = join(stage, 'package');
    await mkdir(packages);
    await writeFile(join(packages, 'package.json'), JSON.stringify(manifest), { mode: 0o600 });
    await writeFile(join(packages, 'package-lock.json'), JSON.stringify(lock), { mode: 0o600 });
    await writeFile(join(stage, 'user.npmrc'), '', { mode: 0o600 });
    await writeFile(join(stage, 'global.npmrc'), '', { mode: 0o600 });
    update({
      phase: 'installing',
      message: t('installRuntime.installingPi', { value1: PI_VERSION }),
    });
    await command(
      join(stage, windows ? 'node/node.exe' : 'node/bin/node'),
      [
        join(
          stage,
          windows
            ? 'node/node_modules/npm/bin/npm-cli.js'
            : 'node/lib/node_modules/npm/bin/npm-cli.js',
        ),
        'ci',
        '--ignore-scripts',
        '--omit=dev',
        '--include=optional',
        '--no-audit',
        '--no-fund',
        '--registry=https://registry.npmjs.org',
        `--userconfig=${join(stage, 'user.npmrc')}`,
        `--globalconfig=${join(stage, 'global.npmrc')}`,
        `--cache=${join(dirname(root), 'npm-cache')}`,
      ],
      signal,
      {
        cwd: packages,
        env: piEnvironment(
          join(stage, windows ? 'node' : 'node/bin'),
          windows
            ? {
                SystemRoot: process.env.SystemRoot,
                TEMP: process.env.TEMP,
                TMP: process.env.TMP,
                USERPROFILE: process.env.USERPROFILE,
                PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
              }
            : { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR },
        ),
      },
    );
    if (!windows) {
      await mkdir(join(stage, 'bin'));
      await symlink('../node/bin/node', join(stage, 'bin/node'));
      await symlink(
        `../package/node_modules/${PI_PACKAGE}/dist/bundle/cli.js`,
        join(stage, 'bin/pi'),
      );
    }
    update({ phase: 'verifying', message: t('installRuntime.verifyingInstalledPi') });
    const verified = await checkPi(managedPiPath(stage));
    if (!verified.supported || !verified.nativeMcp || !verified.exactSessions)
      throw new Error(t('installRuntime.installedPiFailedVerification'));
    signal.throwIfAborted();
    await rename(stage, root);
    return { ...verified, path: managedPiPath(root) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
