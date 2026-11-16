import { t } from '../../shared/i18n/index.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { TeamDelivery } from '../team-mcp/types.ts';
import { runKey, type LiveRun } from './RunTypes.ts';
import { processAlive } from './terminal.ts';
export function runTeamAccess(state: {
  live: Map<string, LiveRun>;
  chains: Map<string, symbol>;
  changing: Set<string>;
  opening: Set<string>;
  retiring: Map<string, Promise<void>>;
  assertUnchanged: (projectId: string) => void;
  open: (
    request: LaunchAgentRequest,
    message: string,
    beforeDispatch: (run: PreparedRun) => Promise<void>,
    delivery: TeamDelivery,
  ) => Promise<LaunchAgentResult>;
}) {
  return {
    inspect(projectId: string, agentId: string) {
      const live = state.live.get(runKey({ projectId, agentId }));
      if (!live || !live.pid || !processAlive(live.pid)) return;
      return {
        run: live.run,
        status: live.status,
        blocked: live.blocked,
        sequence: live.sequence,
        opened: live.opened === true,
        delivering: !!live.run.teamDelivery && live.sequence === 0,
      };
    },
    teamUnavailable(projectId: string, agentId: string) {
      const key = runKey({ projectId, agentId });
      if (state.chains.has(projectId))
        return 'В проекте включена цепочка. Доставка team ожидает её завершения или явного выключения.';
      if (state.changing.has(projectId) || state.opening.has(key) || state.retiring.has(key))
        return 'Диалог/проект ещё подготавливается.';
      const live = this.inspect(projectId, agentId);
      if (live?.blocked || live?.status === 'waiting' || live?.status === 'error')
        return 'Получатель ожидает пользователя.';
      if (live?.status === 'running' || live?.delivering) return 'Получатель выполняет запрос.';
    },
    launchTeamTask(
      projectId: string,
      agentId: string,
      text: string,
      delivery: TeamDelivery,
      beforeDispatch: (run: PreparedRun) => Promise<void>,
    ) {
      const reason = this.teamUnavailable(projectId, agentId);
      if (reason) throw new Error(reason);
      return state.open(
        { projectId, agentId, autoContinue: false },
        text,
        beforeDispatch,
        delivery,
      );
    },
    assertTeamDispatch(projectId: string, agentId: string, runId: string) {
      state.assertUnchanged(projectId);
      if (
        state.chains.has(projectId) ||
        state.live.get(runKey({ projectId, agentId }))?.run.record.runId !== runId
      )
        throw new Error(t('error.runTeamAccess.theChainOrExactDialogue'));
    },
  };
}
