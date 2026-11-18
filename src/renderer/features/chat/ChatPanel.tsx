import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, MessageSquare, Power, Send, Square, X } from 'lucide-react';
import type { ChatTarget } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';
import { Button, IconButton } from '@/shared/ui';
import { Textarea } from '@/shared/ui/Textarea';
import { Select } from '@/shared/ui/Select';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';
import { useConfirm } from '@/shared/model/Confirm';
import { useChatPanels } from './ChatPanels.context';
import { useChat } from './useChat';
import { ChatExtensionDialog } from './ChatExtensionDialog';
import { ChatTranscript } from './ChatTranscript';
import { ChatQueuedMessages } from './ChatQueuedMessages';
import './chat.css';

export function ChatPanel({
  target,
  name,
  standalone = false,
}: {
  target: ChatTarget;
  name: string;
  standalone?: boolean;
}) {
  useTranslation(undefined, { i18n });
  const panels = useChatPanels(),
    { confirm } = useConfirm();
  const { state, error: readError } = useChat(target);
  const key = `${panels.draftScope}/${target.projectId}/${target.agentId}`;
  const [draft, setDraft] = useState(() => panels.drafts.get(key) ?? '');
  const [references, updateReferences] = useState<ReferenceAttachment[]>(
    () => panels.attachments.get(key) ?? [],
  );
  const setReferences = (files: ReferenceAttachment[]) => {
    updateReferences(files);
    panels.setAttachments(key, files);
  };
  const [sending, setSending] = useState(false),
    [error, setError] = useState('');
  const [behavior, setBehavior] = useState<'steer' | 'followUp'>('followUp');
  const transcript = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    submitting = useRef(false);
  const updateDraft = (text: string) => {
    setDraft(text);
    panels.setDraft(key, text);
  };
  const editorRequest = useRef('');
  useEffect(() => {
    if (state?.editorText && state.editorText.id !== editorRequest.current) {
      editorRequest.current = state.editorText.id;
      setDraft(state.editorText.text);
      panels.drafts.set(key, state.editorText.text);
    }
  }, [state?.editorText, panels.drafts, key]);
  useEffect(() => {
    if (stick.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [state?.revision]);
  const opening = panels.opening || (!panels.error && !readError && state?.phase === 'opening');
  const ready = state?.phase === 'ready' && !opening;
  const issue = error || panels.error || readError || state?.error;
  const send = async () => {
    if (!window.studio || !ready || submitting.current || !draft.trim()) return;
    submitting.current = true;
    setSending(true);
    setError('');
    const text = draft;
    stick.current = true;
    try {
      await window.studio.sendChat({
        ...target,
        text,
        attachments: references.map((item) => item.id),
        ...(state?.working ? { behavior } : {}),
      });
      updateDraft('');
      await window.studio.releaseReferenceFiles(references.map((item) => item.id));
      setReferences([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Chat.commandFailed'));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const stop = async () => {
    try {
      await window.studio?.abortChat(target);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Chat.commandFailed'));
    }
  };
  return (
    <section
      className={`pi-chat-panel${standalone ? ' pi-chat-standalone' : ''}`}
      aria-label={t('Chat.title', { name })}
    >
      <header className="pi-chat-header">
        <MessageSquare size={17} aria-hidden="true" />
        <div className="pi-chat-heading">
          <h2>{name}</h2>
          {state?.model && (
            <small>
              {state.model} · {state.thinkingLevel}
            </small>
          )}
        </div>
        <IconButton
          title={t('Chat.closeProcess')}
          disabled={!state || state.phase === 'closed' || opening}
          onClick={() =>
            confirm({
              title: t('Chat.closeProcess'),
              description: t('Chat.closeProcessDescription'),
              confirmLabel: t('Chat.closeProcess'),
              onConfirm: () => {
                void window.studio
                  ?.closeChat(target)
                  .catch((error: unknown) =>
                    setError(error instanceof Error ? error.message : t('Chat.commandFailed')),
                  );
              },
            })
          }
        >
          <Power size={16} />
        </IconButton>
        <IconButton title={t('Chat.hide')} onClick={panels.hide}>
          <X size={18} />
        </IconButton>
      </header>
      <div
        className="pi-chat-transcript"
        ref={transcript}
        role="log"
        aria-label={t('Chat.messages')}
        aria-live="off"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70;
        }}
      >
        {state?.historyTruncated && <p className="subtle">{t('Chat.historyTruncated')}</p>}
        {state && <ChatTranscript messages={state.messages} name={name} working={state.working} />}
        {state && <ChatQueuedMessages queue={state.queue} phase={state.phase} />}
        {!state && !opening && !issue && <p role="status">{t('Chat.loading')}</p>}
        {opening && (
          <div className="pi-chat-loading" role="status">
            <LoaderCircle className="project-launch-spinner" size={24} aria-hidden="true" />
            <p>{t('Chat.opening')}</p>
            <small>{t('Chat.openingHint')}</small>
          </div>
        )}
        {!opening &&
          ready &&
          !state?.messages.length &&
          !state?.queue?.steering.length &&
          !state?.queue?.followUp.length && (
            <p className="pi-chat-empty">{t('Chat.firstMessage')}</p>
          )}
        {state?.working && (
          <div className="pi-chat-working" role="status">
            <LoaderCircle size={16} className="project-launch-spinner" aria-hidden="true" />
            {t('Chat.working')}
          </div>
        )}
        {state?.notification && (
          <p className="subtle" role="status">
            {state.notification}
          </p>
        )}
        {issue && (
          <div className="pi-chat-error" role="alert">
            <p>{issue}</p>
            {!ready && !opening && (
              <Button onClick={() => void panels.open(target)}>{t('Chat.retry')}</Button>
            )}
          </div>
        )}
        {state?.phase === 'closed' && (
          <div className="pi-chat-error">
            <p>{t('Chat.closed')}</p>
            <Button onClick={() => void panels.open(target)}>{t('Chat.reopen')}</Button>
          </div>
        )}
      </div>
      {state?.dialog && (
        <ChatExtensionDialog key={state.dialog.id} target={target} dialog={state.dialog} />
      )}
      <footer className="pi-chat-composer" aria-busy={sending || undefined}>
        <Textarea
          aria-label={t('Chat.message')}
          placeholder={t('Chat.placeholder')}
          value={draft}
          disabled={sending}
          maxLength={200000}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="pi-chat-composer-actions">
          {target.projectId !== 'pi-setup-assistant' && (
            <ReferenceAttachments
              value={references}
              onChange={setReferences}
              disabled={!ready || sending}
              retainOnUnmount
              compact
            />
          )}
          {state?.working && (
            <Select
              label={t('Chat.queueMode')}
              value={behavior}
              onValueChange={(value) => setBehavior(value as 'steer' | 'followUp')}
              options={[
                { value: 'followUp', label: t('Chat.followUp') },
                { value: 'steer', label: t('Chat.steer') },
              ]}
            />
          )}
          <span className="pi-chat-composer-spacer" />
          {state?.working && (
            <IconButton title={t('Chat.stop')} onClick={() => void stop()}>
              <Square size={17} />
            </IconButton>
          )}
          <IconButton
            title={state?.working ? t('Chat.enqueue') : t('Chat.send')}
            disabled={!ready || !draft.trim()}
            busy={sending}
            onClick={() => void send()}
          >
            {sending ? (
              <LoaderCircle size={18} className="project-launch-spinner" />
            ) : (
              <Send size={18} />
            )}
          </IconButton>
        </div>
      </footer>
    </section>
  );
}
