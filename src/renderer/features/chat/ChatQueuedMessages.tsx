import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatQueue, ChatState } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';

/** A view of the native queue, never synthetic history or a second delivery mechanism. */
export function ChatQueuedMessages({
  queue,
  phase,
}: {
  queue?: ChatQueue;
  phase: ChatState['phase'];
}) {
  useTranslation(undefined, { i18n });
  if (!queue || (!queue.steering.length && !queue.followUp.length)) return null;
  const available = phase === 'ready' || phase === 'opening';
  return (
    <section className="pi-chat-queued" aria-label={t('Chat.pendingMessages')}>
      {(['steering', 'followUp'] as const).flatMap((kind) =>
        queue[kind].map((text, index) => (
          <article
            className="pi-chat-message"
            data-role="user"
            data-queue-kind={kind}
            key={`${kind}-${index}`}
          >
            <span className="pi-chat-role">
              <Clock3 size={13} aria-hidden="true" />
              {t('Chat.you')} ·{' '}
              {t(
                !available
                  ? 'Chat.queueUndelivered'
                  : kind === 'steering'
                    ? 'Chat.queuedSteer'
                    : 'Chat.queuedFollowUp',
              )}
            </span>
            <p className="pi-chat-queued-text">{text}</p>
          </article>
        )),
      )}
    </section>
  );
}
