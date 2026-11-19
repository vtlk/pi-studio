import { t } from '../../shared/i18n/index.ts';
import type { LaunchAgentRequest } from '../../shared/runtime.ts';
import type { TeamDelivery } from '../team-mcp/types.ts';
import type { RunOpeningState } from './openRun.ts';
import { runKey, type LiveRun } from './RunTypes.ts';

export function assertTeamNotBusy(live: LiveRun) {
  const chat = live.embedded;
  if (!chat?.alive) throw Error(t('Chat.disconnected'));
  if (
    live.status === 'running' ||
    chat.state.working ||
    chat.state.dialog ||
    chat.state.queue?.steering.length ||
    chat.state.queue?.followUp.length
  )
    throw Error(t('error.runHost.theNextAgentIsAlready'));
}

export function assertIdleTeam(live: LiveRun) {
  assertTeamNotBusy(live);
  if (live.embedded?.state.phase !== 'ready') throw Error(t('Chat.disconnected'));
}

/** One explicit team task in the existing idle dialogue. Never replace its process or history. */
export async function reuseIdleTeam(
  state: Pick<
    RunOpeningState,
    'live' | 'chats' | 'dependencies' | 'assertUnchanged' | 'assertTeamDispatch'
  >,
  request: LaunchAgentRequest,
  live: LiveRun,
  text: string,
  delivery: TeamDelivery,
  beforeDispatch: (run: LiveRun['run']) => Promise<void>,
) {
  const idle = () => {
    const chat = live.embedded;
    state.assertUnchanged(request.projectId);
    if (state.live.get(runKey(request)) !== live || !chat?.alive || chat.state.phase !== 'ready')
      throw Error(t('Chat.disconnected'));
    assertIdleTeam(live);
    state.assertTeamDispatch(request.projectId, request.agentId, live.run.record.runId);
  };
  idle();
  const previous = {
    delivery: live.run.teamDelivery,
    text: live.pendingTeamText,
    check: live.automaticCheck,
  };
  const sequence = live.sequence;
  let claimed = false;
  let started = false;
  try {
    const disposition = await state.chats.sendAutomatic({ ...request, text }, async (recipient) => {
      idle();
      if (recipient !== live) throw Error(t('Chat.disconnected'));
      await beforeDispatch(live.run);
      idle();
      claimed = true;
      live.run.teamDelivery = delivery;
      live.pendingTeamText = text;
      live.automaticCheck = () =>
        state.assertTeamDispatch(request.projectId, request.agentId, live.run.record.runId);
    });
    started = disposition === 'started';
    if (!started) throw Error(t('error.runHost.theNextAgentDidNotAccept'));
    return { runId: live.run.record.runId, project: await state.dependencies.read(live.run) };
  } catch (error) {
    if (claimed && live.sequence === sequence) {
      live.run.teamDelivery = previous.delivery;
      live.pendingTeamText = previous.text;
      live.automaticCheck = previous.check;
    }
    if (
      claimed &&
      !started &&
      live.sequence === sequence + 1 &&
      live.embedded?.alive &&
      live.embedded.state.phase === 'ready' &&
      !live.embedded.state.working &&
      !live.embedded.state.dialog &&
      !live.embedded.state.queue?.steering.length &&
      !live.embedded.state.queue?.followUp.length
    ) {
      live.status = 'waiting';
      live.automaticCheck = undefined;
      await state.dependencies.update(live.run, 'waiting').catch(() => {});
    }
    throw error;
  }
}
