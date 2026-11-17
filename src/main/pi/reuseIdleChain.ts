import { t } from '../../shared/i18n/index.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { RunOpeningState } from './openRun.ts';
import { runKey, type LiveRun, type Continuation } from './RunTypes.ts';

/** Admit one chain task into the existing native dialogue; never queue, respawn or replace history. */
export async function reuseIdleChain(
  state: Pick<RunOpeningState, 'live' | 'chats' | 'dependencies' | 'assertUnchanged'>,
  request: LaunchAgentRequest,
  live: LiveRun,
  message: string,
  continuation: Continuation,
): Promise<LaunchAgentResult> {
  const key = runKey(request);
  const idle = () => {
    const chat = live.embedded;
    if (state.live.get(key) !== live || !chat?.alive || chat.state.phase !== 'ready')
      throw new Error(t('Chat.disconnected'));
    if (
      live.status === 'running' ||
      chat.state.working ||
      chat.state.dialog ||
      chat.state.queue?.steering.length ||
      chat.state.queue?.followUp.length
    )
      throw new Error(t('error.runHost.theNextAgentIsAlready'));
  };
  idle();
  if (state.chats.sendingTo(request.projectId, request.agentId))
    throw new Error(t('error.runHost.theNextAgentIsAlready'));
  let claimed = false;
  const previous = {
    request: live.request,
    chain: live.chain,
    continueAfterSequence: live.continueAfterSequence,
    automaticCheck: live.automaticCheck,
    preserveProcessOnAdmissionCancel: live.preserveProcessOnAdmissionCancel,
  };
  let sequence = live.sequence;
  try {
    const disposition = await state.chats.sendAutomatic(
      { projectId: request.projectId, agentId: request.agentId, text: message },
      (recipient) => {
        state.assertUnchanged(request.projectId);
        continuation.check();
        idle();
        if (recipient !== live) throw new Error(t('Chat.disconnected'));
        sequence = live.sequence;
        claimed = true;
        live.request = { ...live.request, autoContinue: true };
        live.chain = continuation.token;
        live.continueAfterSequence = sequence + 1;
        live.automaticCheck = continuation.check;
        live.preserveProcessOnAdmissionCancel = true;
      },
    );
    if (disposition !== 'started') throw new Error(t('error.runHost.theNextAgentDidNotAccept'));
    return { runId: live.run.record.runId, project: await state.dependencies.read(live.run) };
  } catch (error) {
    if (claimed && live.sequence === sequence) Object.assign(live, previous);
    else if (claimed) {
      // Admission may already have happened: pause without replaying or killing this existing process.
      live.request.autoContinue = false;
      live.automaticCheck = undefined;
      live.preserveProcessOnAdmissionCancel = undefined;
    }
    throw error;
  }
}
