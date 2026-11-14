import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { processAlive } from './terminal.ts';

export async function stopRunProcess(live: LiveRun, closed: RunDependencies['closed']) {
  closed?.(live.run);
  if (!live.pid || !processAlive(live.pid)) return;
  process.kill(live.pid, 'SIGTERM');
  for (let i = 0; i < 100 && processAlive(live.pid); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (processAlive(live.pid))
    throw new Error('Pi ещё закрывается. Повторите через несколько секунд.');
}
