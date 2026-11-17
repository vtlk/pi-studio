import type { AgentRefreshRun, AgentRefreshConsent } from '../../shared/agentRefresh.ts';
import type { ProjectCommandResult } from '../../shared/storage.ts';
import type { LiveRun } from './RunTypes.ts';
import { runKey } from './RunTypes.ts';
import { processAlive } from './terminal.ts';
import { t } from '../../shared/i18n/index.ts';

export interface RefreshRunState {
  live: Map<string, LiveRun>;
  opening: Set<string>;
  retiring: Map<string, Promise<void>>;
  refreshing: Set<string>;
  assertOpen: (projectId: string) => void;
  sending: (projectId: string, agentId: string) => boolean;
  stop: (projectId: string, agentId: string) => Promise<void>;
  launch: (projectId: string, agentId: string) => Promise<unknown>;
  changed: (projectId: string, agentId: string) => void;
}
export function refreshRunSnapshot(
  state: Pick<RefreshRunState, 'live' | 'opening' | 'retiring' | 'refreshing' | 'sending'>,
  projectId: string,
  ids: string[],
): AgentRefreshRun[] {
  return ids.flatMap((agentId) => {
    const key = runKey({ projectId, agentId }),
      live = state.live.get(key);
    if (state.opening.has(key) || state.retiring.has(key) || state.refreshing.has(key))
      throw new Error(t('AgentRefresh.waitOpening'));
    if (!live || (live.embedded ? !live.embedded.alive : !live.pid || !processAlive(live.pid)))
      return [];
    return [
      {
        agentId,
        agentName: live.run.agent.profile.name,
        runId: live.run.record.runId,
        sequence: live.sequence,
        working:
          live.status === 'running' ||
          live.embedded?.state.working === true ||
          !!live.embedded?.state.queue?.steering.length ||
          !!live.embedded?.state.queue?.followUp.length ||
          state.sending(projectId, agentId),
      },
    ];
  });
}
export async function refreshRuns(
  state: RefreshRunState,
  projectId: string,
  affectedIds: string[],
  restarting: AgentRefreshRun[],
  removing: AgentRefreshRun[],
  consent: AgentRefreshConsent,
  apply: () => Promise<ProjectCommandResult>,
): Promise<ProjectCommandResult> {
  state.assertOpen(projectId);
  const expected = [...restarting, ...removing],
    ids = affectedIds;
  const current = refreshRunSnapshot(state, projectId, ids);
  for (const run of current) {
    const previous = expected.find((item) => item.agentId === run.agentId);
    if (
      !previous ||
      previous.runId !== run.runId ||
      previous.sequence !== run.sequence ||
      (run.working &&
        !consent.running.some((item) => item.runId === run.runId && item.sequence === run.sequence))
    )
      throw new Error(t('AgentRefresh.reviewChanged'));
  }
  for (const id of ids) state.refreshing.add(runKey({ projectId, agentId: id }));
  try {
    const stopped = await Promise.allSettled(
      current.map((run) => state.stop(projectId, run.agentId)),
    );
    const failed = stopped.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const result = await apply();
    const failures: NonNullable<ProjectCommandResult['refreshFailures']> = [];
    const project = result.projects.find((item) => item.id === projectId);
    await Promise.all(
      restarting.map(async (run) => {
        if (!project?.agents.find((agent) => agent.profile.id === run.agentId)?.profile.enabled)
          return;
        // Reopen only this existing dialogue. Never replay the interrupted task or arm a chain.
        try {
          await state.launch(projectId, run.agentId);
        } catch (error) {
          failures.push({
            agentId: run.agentId,
            name: run.agentName,
            message: error instanceof Error ? error.message : t('Chat.couldNotStart'),
          });
        }
      }),
    );
    return { ...result, ...(failures.length ? { refreshFailures: failures } : {}) };
  } finally {
    for (const id of ids) {
      state.refreshing.delete(runKey({ projectId, agentId: id }));
      state.changed(projectId, id);
    }
  }
}
