import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { shellQuote } from './provider.ts';
import { openTerminalCommand } from './terminalCommand.ts';

const execute = promisify(execFile);
export async function openSessionTerminal(node: string, bridge: string, bootstrap: string) {
  const path = `${dirname(node)}:${dirname(await realpath(node))}`;
  await openTerminalCommand(
    `export PATH=${shellQuote(path)}:"$PATH"; export PI_TELEMETRY=0; exec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(bootstrap)}`,
  );
}
export async function activateSessionTerminal() {
  await execute('/usr/bin/open', ['-a', 'Terminal'], { timeout: 10_000, maxBuffer: 10_000 });
}
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
