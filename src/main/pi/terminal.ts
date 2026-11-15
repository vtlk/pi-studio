import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { shellQuote } from './provider.ts';
import { openTerminalCommand, activateTerminalProcess } from './terminalCommand.ts';
import { runTerminalTitle } from './terminalTitle.ts';
import type { LiveRun } from './RunTypes.ts';

export async function openSessionTerminal(
  node: string,
  bridge: string,
  bootstrap: string,
  title?: string,
) {
  const path = `${dirname(node)}:${dirname(await realpath(node))}`;
  await openTerminalCommand(
    `export PATH=${shellQuote(path)}:"$PATH"; export PI_TELEMETRY=0; exec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(bootstrap)}`,
    undefined,
    title,
  );
}
export const activateSessionTerminal = (pid: number, title?: string) =>
  activateTerminalProcess(pid, undefined, title);
export async function focusRunningTerminal(run: LiveRun, activate = activateSessionTerminal) {
  if (!run.pid) throw new Error('Не удалось определить окно выбранного диалога Pi.');
  await activate(run.pid, runTerminalTitle(run.run));
}
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
