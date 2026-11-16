import { t } from '../../shared/i18n/index.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller, TeamMessage, TeamHost } from './types.ts';
import { TeamJournal, messageHash } from './TeamJournal.ts';
import { teamScope, recipient } from './scope.ts';
import { deliveryText } from './receipt.ts';
import { needsUser } from './attention.ts';
export async function dispatchTeamMessage(
  service: StudioService,
  host: TeamHost | undefined,
  run: TeamCaller,
  item: TeamMessage,
  journal: TeamJournal,
) {
  if (!host) return;
  const reason = host.teamUnavailable(item.projectId, item.recipientId);
  if (reason) {
    await journal.update(item.id, (previous) => ({ ...previous, reason }));
    return;
  }
  try {
    const scope = await teamScope(service, run);
    if (scope.project.sourceTeamId !== item.sourceTeamId)
      throw new Error(t('error.teamSupport.theSourceTeamChanged'));
    const { saved } = recipient(scope, { agent_id: item.recipientId });
    if (
      saved.runStatus === 'waiting' ||
      saved.runStatus === 'error' ||
      (await needsUser(scope.root, item.recipientId))
    ) {
      await journal.update(item.id, (previous) => ({
        ...previous,
        reason:
          'Получатель ожидает пользователя после вопроса/ошибки. Продолжите его диалог вручную.',
      }));
      return;
    }
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
        host!.assertTeamDispatch(item.projectId, item.recipientId, targetRun.record.runId);
        const fresh = await teamScope(service, run);
        const target = recipient(fresh, { agent_id: item.recipientId }).saved;
        if (
          fresh.project.sourceTeamId !== item.sourceTeamId ||
          (item.expectedSession && target.session?.id !== item.expectedSession.id)
        )
          throw new Error(t('error.dispatch.theRecipientTeamChangedBefore'));
        await journal.update(item.id, (previous) => {
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
    );
  } catch {
    await journal.update(item.id, (previous) =>
      previous.state === 'queued'
        ? {
            ...previous,
            state: 'failed',
            reason:
              'Получатель недоступен. Проверьте его подключение, модель, диалог и ресурсы. Сообщение не отправлено.',
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
