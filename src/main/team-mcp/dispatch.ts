import { t } from '../../shared/i18n/index.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller, TeamChainCorrection, TeamMessage, TeamHost } from './types.ts';
import { TeamJournal, messageHash } from './TeamJournal.ts';
import { isEarlierStage, teamScope, recipient, type TeamScope } from './scope.ts';
import { deliveryText } from './receipt.ts';
import { teamDispatchFailure } from './dispatchFailure.ts';
export async function dispatchTeamMessage(
  service: StudioService,
  host: TeamHost | undefined,
  run: TeamCaller,
  item: TeamMessage,
  journal: TeamJournal,
  correction?: TeamChainCorrection,
) {
  if (!host) return;
  const correctionIsCurrent = () =>
    !item.chainCorrection || correction?.isCurrent(item.projectId, item.recipientId);
  const checkOrder = (scope: TeamScope) => {
    if (correction && !isEarlierStage(scope, item.senderId, item.recipientId))
      throw new Error(t('error.dispatch.theRecipientTeamChangedBefore'));
  };
  try {
    if (!correctionIsCurrent()) throw new Error(t('error.teamSupport.chainCorrectionExpired'));
    const reason = host.teamUnavailable(item.projectId, item.recipientId, correction);
    if (reason) {
      await journal.update(item.id, (previous) =>
        previous.state === 'queued' ? { ...previous, reason } : previous,
      );
      return;
    }
    const scope = await teamScope(service, run);
    if (scope.project.sourceTeamId !== item.sourceTeamId)
      throw new Error(t('error.teamSupport.theSourceTeamChanged'));
    checkOrder(scope);
    const { saved } = recipient(scope, { agent_id: item.recipientId });
    if (
      item.expectedSession &&
      (saved.session?.id !== item.expectedSession.id ||
        saved.session.path !== item.expectedSession.path)
    )
      throw new Error(t('error.dispatch.theRecipientSExactBinding'));
    const text = deliveryText(item);
    await host.launchTeamTask(
      item.projectId,
      item.recipientId,
      text,
      {
        messageId: item.id,
        senderId: item.senderId,
        recipientId: item.recipientId,
        lineage: item.lineage,
      },
      async (targetRun) => {
        host.assertTeamDispatch(
          item.projectId,
          item.recipientId,
          targetRun.record.runId,
          correction,
        );
        const fresh = await teamScope(service, run);
        const target = recipient(fresh, { agent_id: item.recipientId }).saved;
        checkOrder(fresh);
        if (
          fresh.project.sourceTeamId !== item.sourceTeamId ||
          (item.expectedSession && target.session?.id !== item.expectedSession.id)
        )
          throw new Error(t('error.dispatch.theRecipientTeamChangedBefore'));
        await journal.update(item.id, (previous) => {
          host.assertTeamDispatch(
            item.projectId,
            item.recipientId,
            targetRun.record.runId,
            correction,
          );
          if (previous.state !== 'queued')
            throw new Error(t('error.dispatch.theTaskWasAlreadyCancelled'));
          return {
            ...previous,
            state: 'dispatching',
            runId: targetRun.record.runId,
            dispatchHash: messageHash(text),
            reason: undefined,
          };
        });
      },
      correction,
    );
  } catch (error) {
    const expired = !correctionIsCurrent();
    const waiting = expired
      ? undefined
      : host.teamUnavailable(item.projectId, item.recipientId, correction);
    await journal.update(item.id, (previous) =>
      previous.state === 'queued'
        ? {
            ...previous,
            state: waiting ? 'queued' : 'failed',
            reason: expired
              ? t('error.teamSupport.chainCorrectionExpired')
              : (waiting ?? teamDispatchFailure(error)),
          }
        : ['completed', 'failed', 'cancelled'].includes(previous.state)
          ? previous
          : {
              ...previous,
              state: 'uncertain',
              reason: 'Приём не подтверждён. Автоматического повтора нет.',
            },
    );
  }
}
