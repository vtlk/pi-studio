import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type Execute = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<unknown>;

/** launch skips Terminal's startup window; do script creates only the requested session. */
export async function openTerminalCommand(command: string, run: Execute = execute, title?: string) {
  const script = `on run argv
  tell application "Terminal"
    launch
    set dialogueTab to do script (item 1 of argv)
    if (count of argv) > 1 then
      set custom title of dialogueTab to item 2 of argv
      set title displays custom title of dialogueTab to true
    end if
    activate
  end tell
end run`;
  try {
    // Pass the command as data, never interpolate paths into AppleScript source.
    await run(
      '/usr/bin/osascript',
      ['-e', script, command, ...(title === undefined ? [] : [title])],
      {
        timeout: 15_000,
        maxBuffer: 10_000,
      },
    );
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

/** Focus only the Terminal tab which owns this live bridge's TTY; never launch or send input. */
export async function activateTerminalProcess(pid: number, run: Execute = execute, title?: string) {
  if (!Number.isSafeInteger(pid) || pid < 2)
    throw new Error('Не удалось определить окно выбранного диалога Pi.');
  let tty: string;
  try {
    const result = await run('/bin/ps', ['-p', String(pid), '-o', 'tty='], {
      timeout: 2000,
      maxBuffer: 10000,
    });
    tty =
      result &&
      typeof result === 'object' &&
      'stdout' in result &&
      typeof result.stdout === 'string'
        ? result.stdout.trim()
        : '';
    if (!/^(?:ttys\d+|tty\d+)$/.test(tty)) throw new Error('Missing Terminal TTY');
  } catch {
    throw new Error(
      'Окно выбранного диалога Pi больше недоступно. Повторите открытие после завершения запроса.',
    );
  }
  const script = `on run argv
  set targetTTY to item 1 of argv
  tell application "Terminal"
    repeat with terminalWindow in windows
      repeat with terminalTab in tabs of terminalWindow
        if tty of terminalTab is targetTTY then
          if (count of argv) > 1 then
            set custom title of terminalTab to item 2 of argv
            set title displays custom title of terminalTab to true
          end if
          set selected tab of terminalWindow to terminalTab
          set miniaturized of terminalWindow to false
          set index of terminalWindow to 1
          activate
          return
        end if
      end repeat
    end repeat
  end tell
  error "Pi Studio dialogue terminal not found" number -1728
end run`;
  try {
    await run(
      '/usr/bin/osascript',
      ['-e', script, `/dev/${tty}`, ...(title === undefined ? [] : [title])],
      {
        timeout: 10000,
        maxBuffer: 10000,
      },
    );
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
    throw new Error('Не удалось найти окно выбранного диалога Pi. Другой диалог не открывался.', {
      cause: error,
    });
  }
}
