import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMissing, readJson, safePath } from './files.ts';

/** A lease is a process hint, not evidence on its own. Never stop a foreign PID. */
export async function hasLiveSessionLease(cwd: string) {
  let lease: { pid?: number; runId?: string } | null;
  try {
    lease = (await readJson(await safePath(cwd, '.pistudio-session-lock.json'))) as typeof lease;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return false;
    throw error;
  }
  if (
    !Number.isSafeInteger(lease?.pid) ||
    lease!.pid! < 2 ||
    typeof lease?.runId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(lease.runId)
  )
    return false;
  try {
    const { stdout } = await promisify(execFile)(
      '/bin/ps',
      ['-p', String(lease.pid), '-o', 'command='],
      {
        timeout: 2000,
        maxBuffer: 100_000,
      },
    );
    return stdout.includes('/session.mjs') && stdout.includes(lease.runId);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) return false;
    throw new Error('Не удалось проверить, закрыт ли диалог Pi. Повторите операцию.', {
      cause: error,
    });
  }
}
