import { lstat, realpath, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NODE_VERSION } from '../pi/runtimeConfig.ts';
import { runtimeCommand, downloadNodeRuntime } from '../pi/installRuntime.ts';
import { windowsPowershell, powershellArguments, powershellLiteral } from '../pi/windowsShell.ts';
import { privateDirectory } from './privateDirectory.ts';

const execute = promisify(execFile);
export async function updateHelperNode(
  root: string,
  appRoot: string,
  candidate: string | undefined,
  signal: AbortSignal,
) {
  if (candidate) {
    try {
      const path = await realpath(candidate),
        inside = relative(appRoot, path);
      if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) {
        const { stdout } = await execute(path, ['--version'], {
          timeout: 10000,
          windowsHide: true,
          signal,
        });
        if (stdout.trim() === `v${NODE_VERSION}`) return path;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  const windows = process.platform === 'win32';
  const executable = join(root, windows ? 'node/node.exe' : 'node/bin/node');
  let existing = false;
  try {
    await lstat(root);
    existing = true;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  if (existing) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
      throw new Error('Папка компонентов обновления перенаправлена.');
    const { stdout } = await execute(executable, ['--version'], {
      timeout: 10000,
      windowsHide: true,
      signal,
    });
    if (stdout.trim() !== `v${NODE_VERSION}`)
      throw new Error('Неподдерживаемая версия компонентов обновления.');
    return executable;
  }
  if (!['arm64', 'x64'].includes(process.arch) || (windows && process.arch !== 'x64'))
    throw new Error('Архитектура компонентов обновления не поддерживается.');
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(dirname(root), '.update-node-'));
  try {
    await privateDirectory(stage);
    const archive = join(stage, windows ? 'node.zip' : 'node.tar.gz');
    await downloadNodeRuntime(archive, process.arch as 'arm64' | 'x64', signal, () => undefined);
    if (windows) {
      const unpacked = join(stage, 'unpacked');
      await runtimeCommand(
        windowsPowershell(),
        powershellArguments(
          `Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(unpacked)}`,
        ),
        signal,
      );
      await rename(join(unpacked, `node-v${NODE_VERSION}-win-x64`), join(stage, 'node'));
      await rm(unpacked, { recursive: true });
    } else {
      await mkdir(join(stage, 'node'));
      await runtimeCommand(
        '/usr/bin/tar',
        ['-xzf', archive, '-C', join(stage, 'node'), '--strip-components=1'],
        signal,
      );
    }
    await rm(archive);
    const node = join(stage, windows ? 'node/node.exe' : 'node/bin/node');
    const { stdout } = await execute(node, ['--version'], {
      timeout: 10000,
      windowsHide: true,
      signal,
    });
    if (stdout.trim() !== `v${NODE_VERSION}`)
      throw new Error('Компоненты обновления не прошли проверку.');
    signal.throwIfAborted();
    await rename(stage, root);
    return executable;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
