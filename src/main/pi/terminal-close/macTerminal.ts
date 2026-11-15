import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
const execute = promisify(execFile);
export type TerminalExecutor = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string }>;

export const captureMacTabScript = `on run argv
  if application "Terminal" is not running then return "absent"
  set targetTTY to item 1 of argv
  tell application "Terminal"
    repeat with terminalWindow in windows
      repeat with terminalTab in tabs of terminalWindow
        if tty of terminalTab is targetTTY then
          if custom title of terminalTab is not item 2 of argv then error "Owned terminal title changed" number -1719
          return (id of terminalWindow as text) & tab & targetTTY
        end if
      end repeat
    end repeat
  end tell
  return "absent"
end run`;
export const closeMacTabScript = `on run argv
  if application "Terminal" is not running then return "closed"
  set targetWindow to item 1 of argv as integer
  set targetTTY to item 2 of argv
  tell application "Terminal"
    repeat with terminalWindow in windows
      repeat with terminalTab in tabs of terminalWindow
          if tty of terminalTab is targetTTY then
            if id of terminalWindow is not targetWindow then error "Owned terminal moved" number -1719
            if custom title of terminalTab is not item 3 of argv then error "Owned terminal title changed" number -1719
            if busy of terminalTab or (count of processes of terminalTab) is not 0 then error "Owned terminal is no longer empty" number -1719
            if (count of tabs of terminalWindow) is not 1 then error "Window contains other tabs" number -1719
            close terminalWindow
            return "closed"
          end if
      end repeat
    end repeat
  end tell
  return "closed"
end run`;

function terminalError() {
  return new Error(
    'Не удалось безопасно закрыть вкладку Pi. Проверьте доступ Pi Studio к Terminal в настройках macOS → Конфиденциальность и безопасность → Автоматизация. Другие вкладки не закрывались.',
  );
}
/** Capture while the exact bridge is live; close its still-empty, single-tab window. Shared windows are preserved; never select by title/index. */
export async function captureMacTab(
  pid: number,
  runId: string,
  bridge: string,
  title: string,
  run: TerminalExecutor = execute,
) {
  if (
    !Number.isSafeInteger(pid) ||
    pid < 2 ||
    !/^[a-zA-Z0-9_-]+$/.test(runId) ||
    !title ||
    title.length > 300 ||
    /[\p{Cc}]/u.test(title)
  )
    throw terminalError();
  try {
    const identity = async () => {
      const result = await run(
        '/bin/ps',
        ['-ww', '-p', String(pid), '-o', 'tty=', '-o', 'lstart=', '-o', 'command='],
        { timeout: 2000, maxBuffer: 16384 },
      );
      const text = result.stdout?.trim() ?? '';
      const tty = text.match(/^(ttys\d+|tty\d+)\s/)?.[1];
      if (!tty || !text.includes(basename(bridge)) || !text.includes(`${runId}.json`))
        throw terminalError();
      return { text, tty: `/dev/${tty}` };
    };
    const terminalIdentity = async () => {
      let pids: string;
      try {
        pids =
          (
            await run('/usr/bin/pgrep', ['-x', 'Terminal'], { timeout: 2000, maxBuffer: 10000 })
          ).stdout?.trim() ?? '';
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 1) return;
        throw error;
      }
      if (!pids) return;
      if (!/^\d+$/.test(pids)) throw terminalError();
      const row =
        (
          await run('/bin/ps', ['-ww', '-p', pids, '-o', 'lstart=', '-o', 'comm='], {
            timeout: 2000,
            maxBuffer: 16384,
          })
        ).stdout?.trim() ?? '';
      if (!row.endsWith('/Terminal.app/Contents/MacOS/Terminal')) throw terminalError();
      return `${pids}:${row}`;
    };
    const terminal = await terminalIdentity();
    if (!terminal) throw terminalError();
    const original = await identity();
    const result = await run(
      '/usr/bin/osascript',
      ['-e', captureMacTabScript, original.tty, title],
      {
        timeout: 10000,
        maxBuffer: 10000,
      },
    );
    const handle = result.stdout?.trim() ?? '';
    const fields = handle.split('\t');
    if (!/^\d+$/.test(fields[0]) || fields.length !== 2 || fields[1] !== original.tty)
      throw terminalError();
    return {
      verify: async () => {
        if ((await identity()).text !== original.text || (await terminalIdentity()) !== terminal)
          throw terminalError();
      },
      close: async () => {
        try {
          const current = await terminalIdentity();
          if (!current) return;
          if (current !== terminal) throw terminalError();
          const closed = await run(
            '/usr/bin/osascript',
            ['-e', closeMacTabScript, fields[0], fields[1], title],
            { timeout: 10000, maxBuffer: 10000 },
          );
          if (closed.stdout?.trim() !== 'closed') throw terminalError();
        } catch {
          throw terminalError();
        }
      },
    };
  } catch {
    throw terminalError();
  }
}
