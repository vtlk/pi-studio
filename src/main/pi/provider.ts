import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ProviderStatus } from '../../shared/contracts.ts';
import { checkPi } from './checkPi.ts';

const execute = promisify(execFile);
export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))
    throw new Error('Некорректный ID провайдера Pi.');
  return value;
}
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
/** Only native Pi auth: no tokens, browser redirects or credential material cross IPC. */
export async function getProviderStatus(path: string, provider: string): Promise<ProviderStatus> {
  const id = providerId(provider);
  const pi = await checkPi(path);
  const options = {
    timeout: 15_000,
    maxBuffer: 100_000,
    env: {
      ...process.env,
      PATH: `${dirname(pi.path)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
    },
  };
  let output: string;
  try {
    output = (
      await execute(pi.path, ['auth', 'check', '--provider', id, '--json', '--no-refresh'], options)
    ).stdout;
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('stdout' in error) ||
      typeof error.stdout !== 'string'
    )
      throw new Error('Не удалось проверить авторизацию Pi.', { cause: error });
    output = error.stdout;
  }
  const result: unknown = JSON.parse(output);
  if (
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    !['ready', 'not_ready', 'invalid'].includes(String(result.status))
  )
    throw new Error('Pi вернул неподдерживаемый ответ проверки авторизации.');
  return { provider: id, status: result.status as ProviderStatus['status'] };
}
export async function openProviderLogin(path: string, provider: string, cwd: string) {
  const id = providerId(provider);
  const pi = await checkPi(path);
  if (!pi.supported)
    throw new Error(`Pi ${pi.version} ещё не проверен со Studio. Поддерживается 1.5.2.`);
  const command = `cd ${shellQuote(cwd)} && PATH=${shellQuote(`${dirname(pi.path)}:${process.env.PATH ?? '/usr/bin:/bin'}`)} ${shellQuote(pi.path)} auth login ${shellQuote(id)}`;
  const script =
    'on run argv\n tell application "Terminal"\n activate\n do script (item 1 of argv)\n end tell\nend run';
  await execute('/usr/bin/osascript', ['-e', script, command], {
    timeout: 15_000,
    maxBuffer: 10_000,
  });
}
