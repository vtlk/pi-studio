import type { WorkspaceProject } from '../../shared/project.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMissing, readJson, safePath } from './files.ts';
import { powershellArguments, windowsPowershell } from '../pi/windowsShell.ts';

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
      process.platform === 'win32' ? windowsPowershell() : '/bin/ps',
      process.platform === 'win32'
        ? powershellArguments(
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${lease.pid}').CommandLine`,
          )
        : ['-p', String(lease.pid), '-o', 'command='],
      {
        timeout: 2000,
        maxBuffer: 100_000,
        windowsHide: true,
      },
    );
    return /[\\/]session\.mjs/.test(stdout) && stdout.includes(lease.runId);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) return false;
    throw new Error('Не удалось проверить, закрыт ли диалог Pi. Повторите операцию.', {
      cause: error,
    });
  }
}

export async function assertProjectSessionsClosed(project: WorkspaceProject, root: string) {
  for (const agent of [
    ...project.agents,
    ...(project.archivedAgents ?? []).map((item) => item.agent),
  ]) {
    const cwd = await safePath(root, agentDirectory(agent.outputPath), true);
    if (await hasLiveSessionLease(cwd))
      throw new Error(
        'В проекте ещё открыт другой процесс Pi. Закройте диалог перед переносом папки.',
      );
  }
}
