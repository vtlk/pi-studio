export class WindowsProcessQueryError extends Error {
  readonly code: 'component' | 'timeout' | 'snapshot' | 'access';
  constructor(code: 'component' | 'timeout' | 'snapshot' | 'access', message: string) {
    super(message);
    this.code = code;
  }
}

/** Native Win32 snapshot: no PowerShell, WMI/CIM, shell, process termination or admin prompt. */
export interface WindowsSessionProcess {
  pid: number;
  commandLine?: string;
}
interface ProcessInfo {
  pid: number;
  commandLine?: string;
}
type Snapshot = (callback: (processes: ProcessInfo[]) => void, flags: number) => void;
export async function windowsSessionProcess(
  pid: number,
  options: {
    snapshot?: Snapshot;
    selfPid?: number;
    timeout?: number;
  } = {},
): Promise<WindowsSessionProcess | null> {
  let snapshot = options.snapshot;
  if (!snapshot) {
    try {
      snapshot = (await import('@vscode/windows-process-tree')).getAllProcesses;
    } catch {
      throw new WindowsProcessQueryError(
        'component',
        'Windows native process component is unavailable',
      );
    }
  }
  const selfPid = options.selfPid ?? process.pid;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new WindowsProcessQueryError('timeout', 'Windows process snapshot timed out')),
      options.timeout ?? 3000,
    );
    const done = (processes: ProcessInfo[]) => {
      clearTimeout(timer);
      // An empty/failed snapshot is NOT evidence that the target exited.
      if (
        !Array.isArray(processes) ||
        processes.some((item) => !item || !Number.isSafeInteger(item.pid)) ||
        !processes.some((item) => item.pid === selfPid)
      ) {
        reject(new WindowsProcessQueryError('snapshot', 'Windows process snapshot was incomplete'));
        return;
      }
      const matches = processes.filter((item) => item.pid === pid);
      if (matches.length > 1) {
        reject(new WindowsProcessQueryError('snapshot', 'Ambiguous Windows process snapshot'));
        return;
      }
      const target = matches[0];
      if (!target) {
        resolve(null);
        return;
      }
      if (
        typeof target.commandLine !== 'string' ||
        !target.commandLine.trim() ||
        target.commandLine.length > 32768
      ) {
        reject(
          new WindowsProcessQueryError('access', 'Windows process command line is unavailable'),
        );
        return;
      }
      resolve({ pid: target.pid, commandLine: target.commandLine });
    };
    try {
      snapshot(done, 2);
    } catch (error) {
      // Microsoft ProcessDataFlag.CommandLine (no memory/CPU polling).
      clearTimeout(timer);
      reject(error);
    }
  });
}
