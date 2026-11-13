import { execFile } from 'node:child_process';
import { chmod, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { atomicText } from '../storage/files.ts';
import { shellQuote } from './provider.ts';

const execute = promisify(execFile);
export async function openSessionTerminal(node: string, bridge: string, bootstrap: string) {
  const launcher = `${bootstrap}.command`;
  const path = `${dirname(node)}:${dirname(await realpath(node))}`;
  await atomicText(
    launcher,
    `#!/bin/zsh\nexport PATH=${shellQuote(path)}:"$PATH"\nexport PI_TELEMETRY=0\nexec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(bootstrap)}\n`,
  );
  await chmod(launcher, 0o700);
  await execute('/usr/bin/open', ['-a', 'Terminal', launcher], {
    timeout: 10_000,
    maxBuffer: 10_000,
  });
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
