import { t } from '../../shared/i18n/index.ts';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ProviderStatus } from '../../shared/contracts.ts';
import { checkPi } from './checkPi.ts';
import { openTerminalCommand } from './terminalCommand.ts';
import { piEnvironment, piNode } from './platform.ts';
import { openWindowsPowerShellCommand } from './windowsTerminal.ts';
import { powershellLiteral } from './windowsShell.ts';

const execute = promisify(execFile);
export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))
    throw new Error(t('error.provider.invalidPiProviderId'));
  return value;
}
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
/** Only native Pi auth: no tokens, browser redirects or credential material cross IPC. */
export async function getProviderStatus(path: string, provider: string): Promise<ProviderStatus> {
  const id = providerId(provider);
  const pi = await checkPi(path);
  const node = await piNode(pi.path);
  const options = {
    timeout: 15_000,
    maxBuffer: 100_000,
    env: {
      ...piEnvironment(dirname(node)),
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
    },
  };
  let output: string;
  try {
    output = (
      await execute(
        process.platform === 'win32' ? node : pi.path,
        [
          ...(process.platform === 'win32' ? [pi.path] : []),
          'auth',
          'check',
          '--provider',
          id,
          '--json',
          '--no-refresh',
        ],
        options,
      )
    ).stdout;
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('stdout' in error) ||
      typeof error.stdout !== 'string'
    )
      throw new Error(t('error.provider.couldNotCheckPiAuthentication'), {
        cause: error,
      });
    output = error.stdout;
  }
  const result: unknown = JSON.parse(output);
  if (
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    !['ready', 'not_ready', 'invalid'].includes(String(result.status))
  )
    throw new Error(t('error.provider.piReturnedAnUnsupportedAuthenticatio'));
  return { provider: id, status: result.status as ProviderStatus['status'] };
}
export async function openProviderLogin(path: string, provider: string, cwd: string) {
  const id = providerId(provider);
  const pi = await checkPi(path);
  if (!pi.supported)
    throw new Error(t('error.provider.piHasNotBeenVerified', { value1: pi.version }));
  if (process.platform === 'win32') {
    const node = await piNode(pi.path);
    await openWindowsPowerShellCommand(
      `Set-Location -LiteralPath ${powershellLiteral(cwd)}; $env:PATH = ${powershellLiteral(piEnvironment(dirname(node)).PATH)}; & ${powershellLiteral(node)} ${powershellLiteral(pi.path)} auth login ${powershellLiteral(id)}`,
      t('error.provider.piSignIn'),
    );
    return;
  }
  const command = `cd ${shellQuote(cwd)} && PATH=${shellQuote(`${dirname(pi.path)}:${process.env.PATH ?? '/usr/bin:/bin'}`)} ${shellQuote(pi.path)} auth login ${shellQuote(id)}`;
  await openTerminalCommand(command);
}
