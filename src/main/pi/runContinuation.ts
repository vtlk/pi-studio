import type { PreparedRun } from './ContextBuilder.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import { runKey, ContinuationCancelled, type LiveRun, type Continuation } from './RunTypes.ts';
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
        throw new Error('Цепочка не может перейти в другой проект.');
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
