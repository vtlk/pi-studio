import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, symlink, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StartupState } from '../../shared/startup.ts';
import { checkPi } from './checkPi.ts';
import { PI_PACKAGE, PI_VERSION, NODE_VERSION, nodeArchives } from './runtimeConfig.ts';

type Progress = (state: StartupState) => void;
export function validateRuntimeLock(manifest: unknown, lock: unknown) {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Повреждён комплект установки Pi.');
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
    throw new Error('Комплект установки не соответствует поддерживаемой версии Pi.');
  for (const item of Object.values(packages)) {
    const entry = object(item);
    if (entry.link) throw new Error('В комплекте установки Pi недопустима внешняя ссылка.');
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
        throw new Error('В комплекте установки Pi неподдерживаемый источник пакета.');
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
      cwd: options.cwd,
      env: options.env,
      stdio: 'ignore',
      signal,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Установка Pi не завершилась вовремя. Повторите попытку.'));
    }, options.timeout ?? 180_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error('Не удалось установить компоненты Pi. Проверьте интернет и свободное место.'),
        );
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
    `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz`,
    { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) },
  );
  if (!response.ok || !response.body)
    throw new Error('Не удалось загрузить компоненты Pi. Проверьте интернет.');
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
      if (received > 150 * 1024 * 1024) throw new Error('Неожиданный размер компонентов Pi.');
      hash.update(chunk);
      await handle.writeFile(chunk);
      update({
        phase: 'downloading',
        message: 'Загружаем компоненты Pi…',
        ...(total > 0 ? { progress: Math.min(1, received / total) } : {}),
      });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close();
  }
  if (hash.digest('hex') !== nodeArchives[arch])
    throw new Error('Не совпала контрольная сумма загрузки. Установка остановлена.');
}
/** A private, pinned installation. No sudo, global npm install, shell profile changes or model calls. */
export async function installPiRuntime(
  root: string,
  bundled: string,
  update: Progress,
  signal: AbortSignal,
  arch: string = process.arch,
) {
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error('Для этого Mac установка Pi не поддерживается.');
  const manifest = JSON.parse(await readFile(join(bundled, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(bundled, 'package-lock.json'), 'utf8'));
  validateRuntimeLock(manifest, lock);
  try {
    await access(root);
    throw new Error(
      'Каталог установки Pi уже существует. Выберите установленный Pi или проверьте папку компонентов.',
    );
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  await mkdir(dirname(root), { recursive: true });
  const stage = join(dirname(root), `.pi-install-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const archive = join(stage, 'node.tar.gz');
    update({ phase: 'downloading', message: 'Загружаем компоненты Pi…' });
    await downloadNode(archive, arch, signal, update);
    await mkdir(join(stage, 'node'));
    update({ phase: 'installing', message: 'Подготавливаем компоненты Pi…' });
    await command(
      '/usr/bin/tar',
      ['-xzf', archive, '-C', join(stage, 'node'), '--strip-components=1'],
      signal,
    );
    await rm(archive);
    const packages = join(stage, 'package');
    await mkdir(packages);
    await writeFile(join(packages, 'package.json'), JSON.stringify(manifest), { mode: 0o600 });
    await writeFile(join(packages, 'package-lock.json'), JSON.stringify(lock), { mode: 0o600 });
    await writeFile(join(stage, 'user.npmrc'), '', { mode: 0o600 });
    await writeFile(join(stage, 'global.npmrc'), '', { mode: 0o600 });
    update({ phase: 'installing', message: `Устанавливаем Pi ${PI_VERSION}…` });
    await command(
      join(stage, 'node/bin/node'),
      [
        join(stage, 'node/lib/node_modules/npm/bin/npm-cli.js'),
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
        env: { PATH: `${join(stage, 'node/bin')}:/usr/bin:/bin`, TMPDIR: process.env.TMPDIR },
      },
    );
    await mkdir(join(stage, 'bin'));
    await symlink('../node/bin/node', join(stage, 'bin/node'));
    await symlink(
      `../package/node_modules/${PI_PACKAGE}/dist/bundle/cli.js`,
      join(stage, 'bin/pi'),
    );
    update({ phase: 'verifying', message: 'Проверяем установленный Pi…' });
    const verified = await checkPi(join(stage, 'bin/pi'));
    if (!verified.supported || !verified.nativeMcp || !verified.exactSessions)
      throw new Error('Установленный Pi не прошёл проверку.');
    signal.throwIfAborted();
    await rename(stage, root);
    return { ...verified, path: join(root, 'bin/pi') };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
