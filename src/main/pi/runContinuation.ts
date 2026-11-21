import { t } from '../../shared/i18n/index.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type {
  AutoContinuationRequest,
  LaunchAgentRequest,
  LaunchAgentResult,
} from '../../shared/runtime.ts';
import { runKey, ContinuationCancelled, type LiveRun, type Continuation } from './RunTypes.ts';
import { processAlive } from './terminal.ts';
export function continuationStartSequence(live: LiveRun) {
  return live.status === 'running' ? Math.max(1, live.sequence) : live.sequence + 1;
}

export function armContinuation(live: LiveRun, token: symbol) {
  if (live.request.autoContinue && live.chain === token) return;
  live.chain = token;
  live.request.autoContinue = true;
  live.continueAfterSequence = continuationStartSequence(live);
}

export function projectContinuationSwitch(live: Map<string, LiveRun>, chains: Map<string, symbol>) {
  const pending = new Map<string, string>();
  const clear = (projectId: string) => {
    pending.delete(projectId);
    chains.delete(projectId);
  };
  return {
    enabled: (projectId: string) => pending.has(projectId) || chains.has(projectId),
    clear,
    launch(request: LaunchAgentRequest) {
      if (!request.autoContinue && pending.get(request.projectId) !== request.agentId)
        return request;
      pending.delete(request.projectId);
      return { ...request, autoContinue: true };
    },
    set(request: AutoContinuationRequest) {
      const { projectId, agentId, enabled } = request;
      if (!enabled) return clear(projectId);
      const selected = live.get(runKey(request));
      if (
        !selected ||
        !(selected.embedded ? selected.embedded.alive : selected.pid && processAlive(selected.pid))
      ) {
        clear(projectId);
        pending.set(projectId, agentId);
        return;
      }
      pending.delete(projectId);
      if (
        selected.request.autoContinue &&
        selected.chain &&
        chains.get(projectId) === selected.chain
      )
        return;
      const token = Symbol();
      chains.set(projectId, token);
      armContinuation(selected, token);
    },
    armPending(run: LiveRun) {
      const { projectId, agentId } = run.request;
      if (pending.get(projectId) !== agentId) return;
      pending.delete(projectId);
      const token = Symbol();
      chains.set(projectId, token);
      armContinuation(run, token);
    },
    cancelRun(run: LiveRun) {
      const projectId = run.run.project.id;
      // A successfully closed stage has already handed ownership forward.
      if (
        run.autoCloseSequence !== run.sequence &&
        run.chain &&
        chains.get(projectId) === run.chain
      )
        chains.delete(projectId);
    },
  };
}

export function runContinuation(
  run: PreparedRun,
  state: {
    live: Map<string, LiveRun>;
    chains: Map<string, symbol>;
    open: (
      request: LaunchAgentRequest,
      message: string,
      continuation: Continuation,
    ) => Promise<LaunchAgentResult>;
  },
) {
  const live = state.live.get(runKey({ projectId: run.project.id, agentId: run.agent.profile.id }));
  if (
    !live ||
    live.run !== run ||
    !live.request.autoContinue ||
    !live.chain ||
    state.chains.get(run.project.id) !== live.chain ||
    live.sequence < (live.continueAfterSequence ?? 1)
  )
    return;
  const token = live.chain,
    sequence = live.sequence;
  const check = () => {
    if (
      state.chains.get(run.project.id) !== token ||
      live.sequence !== sequence ||
      live.blocked ||
      live.status !== 'ready'
    )
      throw new ContinuationCancelled();
  };
  let used = false;
  const handoff = async (request: LaunchAgentRequest, message: string) => {
    if (used) return;
    used = true;
    try {
      if (request.projectId !== run.project.id)
        throw new Error(t('error.runContinuation.theChainCannotMoveTo'));
      check();
      return await state.open({ ...request, autoContinue: true }, message, { token, check });
    } catch (error) {
      try {
        check();
      } catch (cancelled) {
        if (cancelled instanceof ContinuationCancelled) return;
        throw cancelled;
      }
      if (!(error instanceof ContinuationCancelled)) throw error;
    }
  };
  return Object.assign(handoff, {
    check,
    finish: () => {
      check();
      state.chains.delete(run.project.id);
    },
    pause: () => {
      if (state.chains.get(run.project.id) === token) state.chains.delete(run.project.id);
    },
  });
}
