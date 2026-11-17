import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { t } from '../../shared/i18n/index.ts';

interface Options {
  node: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeout: number;
  signal?: AbortSignal;
}

/** One owned SDK helper/process group; never a user Pi, Terminal, browser or system-wide kill. */
export function resourceChild(options: Options): Promise<{ code: number | null; output: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(options.node, options.args, {
      windowsHide: true,
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    });
    let output = '',
      finished = false,
      failure: Error | undefined;
    const decoder = new StringDecoder('utf8');
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let stopLimit: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, code: number | null = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      clearTimeout(stopLimit);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ code, output });
    };
    const alive = () => child.exitCode === null && child.signalCode === null;
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    let stopping: Promise<void> | undefined;
    const stop = (error: Error) => {
      if (finished || failure) return;
      failure = error;
      // Wait for actual close before exposing cancellation; reject safely if termination is unconfirmed.
      stopLimit = setTimeout(
        () => finish(new Error(t('error.nativeResources.stopUnconfirmed'))),
        8000,
      );
      if (!child.pid || !alive()) return;
      if (process.platform === 'win32') {
        stopping = new Promise<void>((done, fail) => {
          execFile(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            (error) => (error && alive() ? fail(error) : done()),
          );
        });
        void stopping.catch(() => finish(new Error(t('error.nativeResources.stopUnconfirmed'))));
      } else {
        try {
          killGroup('SIGTERM');
        } catch (cause) {
          finish(new Error(t('error.nativeResources.stopUnconfirmed'), { cause }));
          return;
        }
        forceKill = setTimeout(() => {
          try {
            killGroup('SIGKILL');
          } catch (cause) {
            finish(new Error(t('error.nativeResources.stopUnconfirmed'), { cause }));
          }
        }, 2000);
      }
    };
    const abort = () => stop(new DOMException(t('error.nativeResources.cancelled'), 'AbortError'));
    const timeout = setTimeout(
      () => stop(new Error(t('error.nativeResources.piDidNotFinishThe'))),
      options.timeout,
    );
    child.once('error', () =>
      finish(failure ?? new Error(t('error.nativeResources.couldNotStartPiS'))),
    );
    child.stdio[3]!.on('data', (data: Buffer) => {
      if (finished || failure) return;
      output += decoder.write(data);
      if (output.length > 500000)
        stop(new Error(t('error.nativeResources.piReturnedAResourceResponse')));
    });
    child.stdio[3]!.on('error', () =>
      stop(new Error(t('error.nativeResources.piCouldNotPerformThe'))),
    );
    child.once('close', async (code) => {
      if (!failure) output += decoder.end();
      if (failure && process.platform !== 'win32') {
        // Root close must not cancel escalation while npm descendants still hold the group.
        try {
          killGroup('SIGKILL');
        } catch (cause) {
          finish(new Error(t('error.nativeResources.stopUnconfirmed'), { cause }));
          return;
        }
      }
      try {
        await stopping;
      } catch {
        finish(new Error(t('error.nativeResources.stopUnconfirmed')));
        return;
      }
      finish(failure, code);
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin!.on('error', () => {});
    if (!failure) child.stdin!.end(options.input);
    else child.stdin!.end();
  });
}
