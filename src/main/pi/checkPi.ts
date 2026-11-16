import { t } from '../../shared/i18n/index.ts';
import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { PiCheck } from '../../shared/contracts.ts';
import { piEnvironment, piNode, windowsPiCli } from './platform.ts';

const execute = promisify(execFile);
export class PiNotFoundError extends Error {}
async function candidates(requested: string) {
  if (requested.trim()) {
    if (!isAbsolute(requested.trim())) throw new Error(t('error.checkPi.enterTheFullPathTo'));
    return [requested.trim()];
  }
  const paths = [
    ...(process.env.PATH ?? process.env.Path ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local/bin'),
    join(homedir(), '.pi/agent/bin'),
  ];
  for (const root of [
    join(homedir(), '.nvm/versions/node'),
    join(homedir(), 'Library/Application Support/Herd/config/nvm/versions/node'),
  ]) {
    try {
      const versions = await readdir(root, { withFileTypes: true });
      paths.push(
        ...versions
          .filter((item) => item.isDirectory())
          .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }))
          .map((item) => join(root, item.name, 'bin')),
      );
    } catch {
      /* Optional Node installations. */
    }
  }
  if (process.platform === 'win32' && process.env.APPDATA)
    paths.push(join(process.env.APPDATA, 'npm'));
  return [
    ...new Set(
      paths
        .filter(Boolean)
        .map((path) => join(path, process.platform === 'win32' ? 'pi.cmd' : 'pi')),
    ),
  ];
}
export async function checkPi(requested: string): Promise<PiCheck> {
  if (typeof requested !== 'string' || requested.length > 4096 || requested.includes('\0'))
    throw new Error(t('error.checkPi.invalidPiPath'));
  for (const candidate of await candidates(requested)) {
    let path: string;
    try {
      path = process.platform === 'win32' ? await windowsPiCli(candidate) : candidate;
      await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    } catch {
      continue;
    }
    const options = {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 100_000,
      env: {
        ...piEnvironment(dirname(path)),
        PI_OFFLINE: '1',
      },
    };
    const executable = process.platform === 'win32' ? await piNode(path) : path;
    const prefix = process.platform === 'win32' ? [path] : [];
    const version = (await execute(executable, [...prefix, '--version'], options)).stdout.trim();
    const help = (await execute(executable, [...prefix, '--help'], options)).stdout;
    return {
      path,
      version,
      supported: version === '1.5.2',
      nativeMcp: help.includes('pi mcp'),
      exactSessions: help.includes('--session <path|id>') && help.includes('--fork <path|id>'),
    };
  }
  throw new PiNotFoundError(t('error.checkPi.piNotFoundInstallEarendil'));
}
