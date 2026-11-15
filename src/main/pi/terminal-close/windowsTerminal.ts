import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { powershellArguments, windowsPowershell } from '../windowsShell.ts';
import { validStudioTerminalIdentity, verifyWindowsProfile } from './windowsProfile.ts';
import type { TerminalExecutor } from './macTerminal.ts';
import type { TerminalIdentity } from '../../../shared/runtime.ts';
const execute = promisify(execFile);

export async function captureWindowsTab(
  pid: number,
  runId: string,
  bridge: string,
  identity: TerminalIdentity | undefined,
  run: TerminalExecutor = execute,
  root?: string,
) {
  if (
    !Number.isSafeInteger(pid) ||
    pid < 2 ||
    !/^[a-zA-Z0-9_-]+$/.test(runId) ||
    !validStudioTerminalIdentity(identity)
  )
    throw new Error(
      'Точный профиль/диалог Windows Terminal не подтверждён. Другие вкладки не закрывались.',
    );
  const read = async () => {
    const result = await run(
      windowsPowershell(),
      powershellArguments(
        `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress`,
      ),
      { timeout: 5000, maxBuffer: 16384 },
    );
    const process = JSON.parse(result.stdout ?? 'null');
    if (
      process?.ProcessId !== pid ||
      typeof process.CommandLine !== 'string' ||
      !process.CommandLine.includes(basename(bridge)) ||
      !process.CommandLine.includes(`${runId}.json`) ||
      !process.CreationDate
    )
      throw new Error('Процесс Windows Pi изменился. Закрытие отменено.');
    return JSON.stringify(process);
  };
  await verifyWindowsProfile(root);
  const original = await read();
  return {
    verify: async () => {
      await verifyWindowsProfile(root);
      if ((await read()) !== original) throw new Error('PID Windows Pi был переиспользован.');
    },
    // Only the owned process exits; Windows Terminal applies this profile's native graceful policy.
    // No window-wide close, keyboard injection or global profile changes.
    close: async () => {
      await verifyWindowsProfile(root);
    },
  };
}
