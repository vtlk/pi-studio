import { Clock3, CornerUpLeft, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatQueue, ChatQueueAction, ChatState } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';
import { IconButton } from '@/shared/ui';

/** A view of the native queue, never synthetic history or a second delivery mechanism. */
export function ChatQueuedMessages({
  queue,
  phase,
  busy,
  onAction,
}: {
  queue?: ChatQueue;
  phase: ChatState['phase'];
  busy?: string;
  onAction?: (id: string, action: ChatQueueAction['action']) => void;
}) {
  useTranslation(undefined, { i18n });
  if (!queue || (!queue.steering.length && !queue.followUp.length)) return null;
  const available = phase === 'ready' || phase === 'opening';
  const entries =
    queue.items ??
    (['steering', 'followUp'] as const).flatMap((kind) =>
      queue[kind].map((text, index) => ({ kind, text, id: '', key: `${kind}-${index}` })),
    );
  return (
    <section className="pi-chat-queued" aria-label={t('Chat.pendingMessages')}>
      {entries.map((item, index) => (
        <article
          className="pi-chat-message"
          data-role="user"
          data-queue-kind={item.kind}
          key={item.id || `${item.kind}-${index}`}
        >
          <div className="pi-chat-queue-heading">
            <span className="pi-chat-role">
              <Clock3 size={13} aria-hidden="true" />
              {t('Chat.you')} ·{' '}
              {t(
                !available
                  ? 'Chat.queueUndelivered'
                  : item.kind === 'steering'
                    ? 'Chat.queuedSteer'
                    : 'Chat.queuedFollowUp',
              )}
            </span>
            {item.id && onAction && (
              <div className="pi-chat-queue-actions" aria-busy={busy === item.id || undefined}>
                {item.kind === 'followUp' && (
                  <IconButton
                    title={t('Chat.queueMakeSteer')}
                    disabled={!!busy || phase !== 'ready'}
                    onClick={() => onAction(item.id, 'steer')}
                  >
                    <CornerUpLeft size={15} />
                  </IconButton>
                )}
                <IconButton
                  title={t('Chat.queueEdit')}
                  disabled={!!busy || phase !== 'ready'}
                  onClick={() => onAction(item.id, 'edit')}
                >
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  title={t('Chat.queueDelete')}
                  disabled={!!busy || phase !== 'ready'}
                  onClick={() => onAction(item.id, 'delete')}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            )}
          </div>
          <p className="pi-chat-queued-text">{item.text}</p>
        </article>
      ))}
    </section>
  );
}
