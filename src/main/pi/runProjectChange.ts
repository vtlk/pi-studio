import type { LiveRun } from './RunTypes.ts';

export async function withRunProjectChange<T>(
  state: { changing: Set<string>; chains: Map<string, symbol>; live: Map<string, LiveRun> },
  projectId: string,
  stopSessions: boolean,
  assertIdle: () => void,
  stop: (agentId: string) => Promise<void>,
  action: () => Promise<T>,
) {
  assertIdle();
  state.changing.add(projectId);
  if (stopSessions) state.chains.delete(projectId);
  try {
    if (stopSessions)
      for (const live of [...state.live.values()])
        if (live.run.project.id === projectId) await stop(live.run.agent.profile.id);
    return await action();
  } finally {
    state.changing.delete(projectId);
  }
}
