import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { shellQuote } from './provider.ts';
import { openTerminalCommand, activateTerminalProcess } from './terminalCommand.ts';

export async function openSessionTerminal(node: string, bridge: string, bootstrap: string) {
  const path = `${dirname(node)}:${dirname(await realpath(node))}`;
  await openTerminalCommand(
    `export PATH=${shellQuote(path)}:"$PATH"; export PI_TELEMETRY=0; exec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(bootstrap)}`,
  );
}
export const activateSessionTerminal = activateTerminalProcess;
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
