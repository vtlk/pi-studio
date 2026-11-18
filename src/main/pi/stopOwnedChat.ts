import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** Only a child spawned by EmbeddedChat with its own process group, never a discovered PID. */
export function stopOwnedChat(
  child: ChildProcessWithoutNullStreams,
  options: {
    platform?: NodeJS.Platform;
    graceMs?: number;
    forceMs?: number;
    exec?: typeof execFile;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  return new Promise((resolve, reject) => {
    let settled = false;
    const alive = () => child.exitCode === null && child.signalCode === null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      child.removeListener('close', closed);
      if (error) reject(error);
      else resolve();
    };
    const group = (signal: NodeJS.Signals) => {
      if (!child.pid || platform === 'win32') return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const closed = () => {
      // RPC can exit while a shell descendant still holds this owned group.
      try {
        group('SIGKILL');
        finish();
      } catch (error) {
        finish(error as Error);
      }
    };
    if (!child.pid) {
      finish();
      return;
    }
    child.once('close', closed);
    if (!alive()) {
      finish();
      return;
    }
    timers.push(
      setTimeout(() => {
        if (platform === 'win32') {
          // Keep the parent alive until taskkill has enumerated its exact descendant tree.
          (options.exec ?? execFile)(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            (error) => {
              if (error && alive()) finish(error);
            },
          );
        } else {
          try {
            group('SIGTERM');
          } catch (error) {
            finish(error as Error);
          }
        }
      }, options.graceMs ?? 5000),
    );
    timers.push(
      setTimeout(
        () => {
          try {
            group('SIGKILL');
          } catch (error) {
            finish(error as Error);
          }
        },
        (options.graceMs ?? 5000) + (options.forceMs ?? 2000),
      ),
    );
    timers.push(
      setTimeout(
        () => {
          if (!alive()) closed();
          else finish(new Error('Owned Pi process did not confirm shutdown.'));
        },
        (options.graceMs ?? 5000) + (options.forceMs ?? 2000) + 5000,
      ),
    );
    // stdin EOF is Pi's supported RPC exit and flushes history/accounting/MCP resources.
    child.stdin.end();
  });
}
