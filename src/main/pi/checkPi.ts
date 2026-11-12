import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { PiCheck } from '../../shared/contracts.ts';

const execute = promisify(execFile);
export class PiNotFoundError extends Error {}
async function candidates(requested: string) {
  if (requested.trim()) {
    if (!isAbsolute(requested.trim()))
      throw new Error(
        'Укажите полный путь к исполняемому файлу Pi или оставьте поле пустым для поиска.',
      );
    return [requested.trim()];
  }
  const paths = [
    ...(process.env.PATH ?? '').split(':'),
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
  return [...new Set(paths.filter(Boolean).map((path) => join(path, 'pi')))];
}
export async function checkPi(requested: string): Promise<PiCheck> {
  if (typeof requested !== 'string' || requested.length > 4096 || requested.includes('\0'))
    throw new Error('Некорректный путь Pi.');
  for (const path of await candidates(requested)) {
    try {
      await access(path, constants.X_OK);
    } catch {
      continue;
    }
    const options = {
      timeout: 10_000,
      maxBuffer: 100_000,
      env: {
        ...process.env,
        PATH: `${dirname(path)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
      },
    };
    const version = (await execute(path, ['--version'], options)).stdout.trim();
    const help = (await execute(path, ['--help'], options)).stdout;
    return {
      path,
      version,
      supported: version === '1.5.2',
      nativeMcp: help.includes('pi mcp'),
      exactSessions: help.includes('--session <path|id>') && help.includes('--fork <path|id>'),
    };
  }
  throw new PiNotFoundError(
    'Pi не найден. Установите @earendil-works/pi-coding-agent и укажите полный путь.',
  );
}
