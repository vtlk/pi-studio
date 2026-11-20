import type { RpcEvent } from './ChatRpc.ts';
import { t } from '../../shared/i18n/index.ts';
import { projectChatQueue } from './chatProjection.ts';

/** App-owned extension command over the unchanged native Pi RPC protocol. */
export function chatCommand(id: string, type: string, args: Record<string, unknown>) {
  return type === 'studio_queue_action'
    ? { id, type: 'prompt', message: '/pistudio-queue-action ' + JSON.stringify({ ...args, id }) }
    : { id, type, ...args };
}
export function normalizeQueueEvent(event: RpcEvent): RpcEvent {
  if (event.type !== 'studio_queue_result') return event;
  return {
    ...event,
    type: 'response',
    error:
      event.error === 'queue_changed'
        ? t('Chat.queueChanged')
        : event.error === 'queue_too_large'
          ? t('Chat.queueEditTooLarge')
          : t('Chat.queueUnsupported'),
  };
}

export function chatQueue(
  previous: import('../../shared/chat.ts').ChatQueue | undefined,
  event: RpcEvent,
) {
  const queue = projectChatQueue(
    event.steering,
    event.followUp,
    event.type === 'studio_queue_update' ? event.items : undefined,
  );
  if (
    event.type === 'queue_update' &&
    JSON.stringify([queue.steering, queue.followUp]) ===
      JSON.stringify([previous?.steering, previous?.followUp])
  )
    queue.items = previous?.items;
  return queue;
}
