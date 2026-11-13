import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type Execute = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<unknown>;

/** launch skips Terminal's startup window; do script creates only the requested session. */
export async function openTerminalCommand(command: string, run: Execute = execute) {
  const script = `on run argv
  tell application "Terminal"
    launch
    do script (item 1 of argv)
    activate
  end tell
end run`;
  try {
    // Pass the command as data, never interpolate paths into AppleScript source.
    await run('/usr/bin/osascript', ['-e', script, command], {
      timeout: 15_000,
      maxBuffer: 10_000,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stderr' in error &&
      String(error.stderr).includes('-1743')
    )
      throw new Error(
        'Разрешите Pi Studio управлять Terminal: Системные настройки → Конфиденциальность и безопасность → Автоматизация.',
        { cause: error },
      );
    throw new Error('Не удалось открыть диалог в Terminal. Повторите запуск.', { cause: error });
  }
}
