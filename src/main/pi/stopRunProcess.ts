import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { processAlive } from './terminal.ts';

export function closeRuns(live: Iterable<LiveRun>, dependencies: RunDependencies) {
  for (const run of live) {
    dependencies.closed?.(run.run);
    if (run.pid && processAlive(run.pid)) process.kill(run.pid, 'SIGTERM');
  }
}

export async function stopRunProcess(live: LiveRun, closed: RunDependencies['closed']) {
  closed?.(live.run);
  if (!live.pid || !processAlive(live.pid)) return;
  process.kill(live.pid, 'SIGTERM');
  for (let i = 0; i < 100 && processAlive(live.pid); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (processAlive(live.pid))
    throw new Error('Pi ещё закрывается. Повторите через несколько секунд.');
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
