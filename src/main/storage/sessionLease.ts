import { t } from '../../shared/i18n/index.ts';
import type { WorkspaceProject } from '../../shared/project.ts';
import { agentRuntimeDirectory } from '../../shared/agentPaths.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMissing, readJson, safePath } from './files.ts';
import { powershellArguments, windowsPowershell } from '../pi/windowsShell.ts';

const execute = promisify(execFile);
function processExists(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
      ? false
      : undefined;
  }
}
interface LeaseDependencies {
  platform?: NodeJS.Platform;
  exists?: (pid: number) => boolean | undefined;
  execute?: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; windowsHide: boolean },
  ) => Promise<{ stdout: string }>;
}
/** A lease is a process hint, not evidence on its own. Never stop a foreign PID. */
export async function hasLiveSessionLease(cwd: string, dependencies: LeaseDependencies = {}) {
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
  const pid = lease!.pid!;
  const exists = dependencies.exists ?? processExists;
  if (exists(pid) === false) return false;
  const windows = (dependencies.platform ?? process.platform) === 'win32';
  try {
    const { stdout } = await (dependencies.execute ?? execute)(
      windows ? windowsPowershell() : '/bin/ps',
      windows
        ? powershellArguments(
            `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
          )
        : ['-p', String(pid), '-o', 'command='],
      {
        // A cold Windows PowerShell/CIM startup routinely takes longer than two seconds.
        timeout: windows ? 15000 : 2000,
        maxBuffer: 100_000,
        windowsHide: true,
      },
    );
    let command = stdout;
    if (windows) {
      const process = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : null;
      if (!process && exists(pid) === false) return false;
      if (
        process?.ProcessId !== pid ||
        typeof process.CommandLine !== 'string' ||
        !process.CommandLine.trim()
      )
        throw new Error('Windows did not return the process command line');
      command = process.CommandLine;
    }
    return /[\\/]session\.mjs/.test(command) && command.includes(lease.runId);
  } catch (error) {
    // PowerShell exit 1 can mean a denied/broken CIM query, not a closed Pi process.
    if (!windows && error && typeof error === 'object' && 'code' in error && error.code === 1)
      return false;
    if (windows && error && typeof error === 'object' && 'killed' in error && error.killed)
      throw new Error(t('error.sessionLease.windowsProcessCheckTimedOut'), { cause: error });
    throw new Error(t('error.sessionLease.couldNotCheckWhetherThe'), {
      cause: error,
    });
  }
}

export async function assertProjectSessionsClosed(project: WorkspaceProject, root: string) {
  for (const agent of [
    ...project.agents,
    ...(project.archivedAgents ?? []).map((item) => item.agent),
  ]) {
    const cwd = await safePath(root, agentRuntimeDirectory(agent), true);
    if (await hasLiveSessionLease(cwd))
      throw new Error(t('error.sessionLease.anotherPiProcessIsStill'));
  }
}
