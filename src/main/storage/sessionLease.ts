import { t } from '../../shared/i18n/index.ts';
import type { WorkspaceProject } from '../../shared/project.ts';
import { agentRuntimeDirectory } from '../../shared/agentPaths.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMissing, readJson, safePath } from './files.ts';
import {
  windowsSessionProcess,
  WindowsProcessQueryError,
  type WindowsSessionProcess,
} from './windowsSessionProcess.ts';

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
  windowsProcess?: (pid: number) => Promise<WindowsSessionProcess | null>;
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
    let command: string;
    if (windows) {
      const target = await (dependencies.windowsProcess ?? windowsSessionProcess)(pid);
      if (!target) return false; // A complete native snapshot proves this PID is absent.
      if (
        target.pid !== pid ||
        typeof target.commandLine !== 'string' ||
        !target.commandLine.trim()
      )
        throw new Error('Windows did not return the exact process command line');
      command = target.commandLine;
    } else {
      const { stdout } = await (dependencies.execute ?? execute)(
        '/bin/ps',
        ['-p', String(pid), '-o', 'command='],
        {
          timeout: 2000,
          maxBuffer: 100_000,
          windowsHide: true,
        },
      );
      command = stdout;
    }
    return /[\\/]session\.mjs/.test(command) && command.includes(lease.runId);
  } catch (error) {
    // A query failure never proves that a Pi process has exited.
    if (!windows && error && typeof error === 'object' && 'code' in error && error.code === 1)
      return false;
    if (windows && exists(pid) === false) return false;
    if (windows && error instanceof WindowsProcessQueryError) {
      const messages = {
        component: 'error.sessionLease.nativeComponent',
        timeout: 'error.sessionLease.nativeTimeout',
        snapshot: 'error.sessionLease.nativeSnapshot',
        access: 'error.sessionLease.nativeAccess',
      } as const;
      throw new Error(`${t(messages[error.code], { pid })} [native_${error.code}]`, {
        cause: error,
      });
    }
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
