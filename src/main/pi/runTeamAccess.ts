import { t } from '../../shared/i18n/index.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { TeamCaller, TeamChainCorrection, TeamDelivery } from '../team-mcp/types.ts';
import { runKey, type LiveRun } from './RunTypes.ts';
import { processAlive } from './terminal.ts';
export function runTeamAccess(state: {
  live: Map<string, LiveRun>;
  chains: Map<string, symbol>;
  changing: Set<string>;
  opening: Set<string>;
  retiring: Map<string, Promise<void>>;
  refreshing?: ReadonlySet<string>;
  assertUnchanged: (projectId: string) => void;
  sending?: (projectId: string, agentId: string) => boolean;
  open: (
    request: LaunchAgentRequest,
    message: string,
    beforeDispatch: (run: PreparedRun) => Promise<void>,
    delivery: TeamDelivery,
    correction?: TeamChainCorrection,
  ) => Promise<LaunchAgentResult>;
}) {
  const chainAllowsTeam = (projectId: string, agentId: string, correction?: TeamChainCorrection) =>
    correction ? correction.isCurrent(projectId, agentId) : !state.chains.has(projectId);
  return {
    inspect(projectId: string, agentId: string) {
      const live = state.live.get(runKey({ projectId, agentId }));
      if (!live || !live.pid || !processAlive(live.pid)) return;
      return {
        run: live.run,
        status: live.status,
        blocked: live.blocked || !!live.embedded?.state.dialog,
        sequence: live.sequence,
        opened: live.opened === true,
        delivering: !!live.run.teamDelivery && live.sequence === 0,
      };
    },
    chainCorrection(
      run: TeamCaller,
      sequence: number | undefined,
      recipientId: string,
      earlier: boolean,
    ): TeamChainCorrection | undefined {
      const projectId = run.project.id;
      const token = state.chains.get(projectId);
      if (!token) return;
      const key = runKey({ projectId, agentId: run.record.agentId });
      const sender = state.live.get(key);
      const isCurrent = (project: string, agent: string) =>
        project === projectId &&
        agent === recipientId &&
        !!sender &&
        state.live.get(key) === sender &&
        state.chains.get(projectId) === token &&
        sender.chain === token &&
        sender.run === run &&
        sender.request.autoContinue &&
        sender.sequence === sequence &&
        sender.sequence >= (sender.continueAfterSequence ?? 1) &&
        sender.status === 'running' &&
        !!sender.pid &&
        processAlive(sender.pid);
      if (!earlier || !sender || !sequence || !isCurrent(projectId, recipientId))
        throw new Error(t('error.teamSupport.taskNotSentTheProject'));
      return { runId: sender.run.record.runId, sequence, isCurrent };
    },
    teamUnavailable(projectId: string, agentId: string, correction?: TeamChainCorrection) {
      const key = runKey({ projectId, agentId });
      if (!chainAllowsTeam(projectId, agentId, correction))
        return 'В проекте включена цепочка. Доставка team ожидает её завершения или явного выключения.';
      if (
        state.changing.has(projectId) ||
        state.opening.has(key) ||
        state.retiring.has(key) ||
        state.refreshing?.has(key) ||
        state.sending?.(projectId, agentId)
      )
        return 'Диалог/проект ещё подготавливается.';
      const live = this.inspect(projectId, agentId);
      if (
        live?.status === 'running' ||
        live?.delivering ||
        state.live.get(key)?.embedded?.state.working ||
        state.live.get(key)?.embedded?.state.dialog ||
        state.live.get(key)?.embedded?.state.queue?.steering.length ||
        state.live.get(key)?.embedded?.state.queue?.followUp.length
      )
        return 'Получатель выполняет запрос.';
    },
    launchTeamTask(
      projectId: string,
      agentId: string,
      text: string,
      delivery: TeamDelivery,
      beforeDispatch: (run: PreparedRun) => Promise<void>,
      correction?: TeamChainCorrection,
    ) {
      const reason = this.teamUnavailable(projectId, agentId, correction);
      if (reason) throw new Error(reason);
      return state.open(
        { projectId, agentId, autoContinue: false },
        text,
        beforeDispatch,
        delivery,
        correction,
      );
    },
    assertTeamDispatch(
      projectId: string,
      agentId: string,
      runId: string,
      correction?: TeamChainCorrection,
    ) {
      state.assertUnchanged(projectId);
      if (
        !chainAllowsTeam(projectId, agentId, correction) ||
        state.live.get(runKey({ projectId, agentId }))?.run.record.runId !== runId
      )
        throw new Error(t('error.runTeamAccess.theChainOrExactDialogue'));
    },
  };
}
