import { t } from '../../shared/i18n/index.ts';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { PI_PACKAGE } from './runtimeConfig.ts';
import { windowsGitDirectories } from './git.ts';

export function managedPiPath(root: string, platform = process.platform) {
  return platform === 'win32'
    ? join(root, 'package/node_modules', PI_PACKAGE, 'dist/bundle/cli.js')
    : join(root, 'bin/pi');
}

/** Preserve Windows' case-insensitive PATH without passing duplicate Path/PATH entries. */
export function piEnvironment(
  directory: string,
  input: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  toolDirectories: string[] = [],
): NodeJS.ProcessEnv & { PATH: string } {
  const env = { ...input };
  const paths = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
  const inherited = paths
    .map((key) => env[key])
    .filter(Boolean)
    .join(platform === 'win32' ? ';' : ':');
  for (const key of paths) delete env[key];
  env.PATH = [
    ...new Set(
      [
        directory,
        ...toolDirectories,
        ...inherited.split(platform === 'win32' ? ';' : ':'),
        ...(platform === 'win32' ? windowsGitDirectories(input) : []),
        ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
      ].filter(Boolean),
    ),
  ].join(platform === 'win32' ? ';' : ':');
  return { ...env, PATH: env.PATH, PI_TELEMETRY: '0' };
}

/** Windows npm shims are never executed through cmd.exe; invoke the canonical CLI with Node. */
export async function piNode(cli: string): Promise<string> {
  if (process.platform !== 'win32') return join(dirname(cli), 'node');
  const candidates: string[] = [];
  let directory = dirname(cli);
  for (let depth = 0; depth < 9; depth++) {
    candidates.push(join(directory, 'node.exe'), join(directory, 'node/node.exe'));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const env = piEnvironment('');
  candidates.push(...env.PATH.split(delimiter).map((path) => join(path, 'node.exe')));
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      /* Optional runtime location. */
    }
  }
  throw new Error(t('error.platform.nodeJsWasNotFound'));
}

export async function windowsPiCli(path: string) {
  if (!/\.(cmd|bat)$/i.test(path)) return path;
  const cli = join(dirname(path), 'node_modules', PI_PACKAGE, 'dist/bundle/cli.js');
  await access(cli);
  return cli;
}
