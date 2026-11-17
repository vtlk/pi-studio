import { processAlive } from './terminal.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import type { RunLifecycle } from './RunLifecycle.ts';
export async function checkRunLiveness(state: {
  live: Map<string, LiveRun>;
  retiring: Map<string, Promise<void>>;
  opening: ReadonlySet<string>;
  lifecycle: RunLifecycle;
  dependencies: RunDependencies;
  remove: (id: string) => void;
}) {
  for (const [key, live] of state.live)
    if (
      !state.retiring.has(key) &&
      ((live.pid && !processAlive(live.pid)) ||
        (!state.opening.has(key) && Date.now() - live.heartbeat > 20000))
    ) {
      const cleanup = state.lifecycle.processLost(live).then(async () => {
        await state.dependencies.observed?.(live.run, { type: 'stopped' });
        state.remove(live.run.record.runId);
        state.live.delete(key);
      });
      state.retiring.set(key, cleanup);
      try {
        await cleanup;
      } finally {
        state.retiring.delete(key);
      }
    }
}
