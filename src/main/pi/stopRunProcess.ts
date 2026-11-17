import { t } from '../../shared/i18n/index.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { processAlive } from './terminal.ts';

export function closeRuns(live: Iterable<LiveRun>, dependencies: RunDependencies) {
  for (const run of live) {
    dependencies.closed?.(run.run);
    if (run.embedded || process.platform === 'win32') run.stop?.();
    else if (run.pid && processAlive(run.pid)) process.kill(run.pid, 'SIGTERM');
  }
}

export async function stopRunProcess(live: LiveRun, closed: RunDependencies['closed']) {
  closed?.(live.run);
  if (live.embedded) {
    live.stop?.();
    for (let i = 0; i < 240 && live.embedded.alive; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (live.embedded.alive) throw new Error(t('error.stopRunProcess.piIsStillClosingTry'));
    return;
  }
  if (!live.pid || !processAlive(live.pid)) return;
  if (live.embedded || process.platform === 'win32') live.stop?.();
  else process.kill(live.pid, 'SIGTERM');
  for (let i = 0; i < 200 && processAlive(live.pid); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (processAlive(live.pid)) throw new Error(t('error.stopRunProcess.piIsStillClosingTry'));
}

export async function drainRunProcesses(live: Iterable<LiveRun>, dependencies: RunDependencies) {
  await Promise.allSettled(
    Array.from(live, async (run) => {
      try {
        await stopRunProcess(run, dependencies.closed);
      } finally {
        await dependencies.accountingLost?.(run.run);
      }
    }),
  );
}
