import { VoiceInput } from '@/features/voice/VoiceInput';
import { FileDropZone } from '@/shared/ui/FileDropZone';
import { stageFiles } from '@/shared/ui/stageFiles';
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
  const draft = panels.drafts.get(key) ?? '';
  const references = panels.attachments.get(key) ?? [];
  const setReferences = (files: ReferenceAttachment[]) => panels.setAttachments(key, files);
  const [sending, setSending] = useState(false),
    [error, setError] = useState('');
  const [attachmentList, setAttachmentList] = useState<HTMLDivElement | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<HTMLDivElement | null>(null);
  const [behavior, setBehavior] = useState<'steer' | 'followUp'>('followUp');
  const transcript = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    submitting = useRef(false);
  const updateDraft = (text: string) => {
    panels.setDraft(key, text);
  };
  const editorRequest = useRef('');
  useEffect(() => {
    if (panels.draftsReady && state?.editorText && state.editorText.id !== editorRequest.current) {
      const first = !editorRequest.current;
      editorRequest.current = state.editorText.id;
      if (!first || !(panels.drafts.get(key) ?? '')) panels.setDraft(key, state.editorText.text);
    }
  }, [state?.editorText, panels, key]);
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
    stick.current = true;
    try {
      if (!(await panels.flushDrafts(key))) throw Error(t('ChatDrafts.saveFailed'));
      const snapshot = panels.currentDraft(key);
      const result = await window.studio.sendChat({
        ...target,
        text: snapshot.text,
        draft: { folder: panels.draftScope, revision: snapshot.revision },
        attachments: snapshot.attachments.map((item) => item.id),
        ...(state?.working ? { behavior } : {}),
      });
      panels.draftSent(key, snapshot.revision, result);
      const retained = new Set((panels.attachments.get(key) ?? []).map((file) => file.id));
      await window.studio
        .releaseReferenceFiles(
          snapshot.attachments.filter((file) => !retained.has(file.id)).map((file) => file.id),
        )
        .catch(() => {});
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Chat.commandFailed'));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const attach = async (files: File[], images = false) => {
    let added: ReferenceAttachment[] = [];
    try {
      added = await stageFiles(files, images);
      const previous = panels.attachments.get(key) ?? [];
      if (previous.length + added.length > 32)
        throw new Error(t('ReferenceAttachments.youCanAttachUpToReferencesPer'));
      setReferences([...previous, ...added]);
    } catch (error) {
      if (added.length) void window.studio?.releaseReferenceFiles(added.map((file) => file.id));
      setError(
        error instanceof Error ? error.message : t('ReferenceAttachments.couldNotSelectFiles'),
      );
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
    <FileDropZone
      as="section"
      ariaLabel={t('Chat.title', { name })}
      label={t('Chat.dropFiles')}
      className={`pi-chat-panel${standalone ? ' pi-chat-standalone' : ''}`}
      disabled={sending || !panels.draftsReady}
      onFiles={(files) => void attach(files)}
      onImages={(files) => void attach(files, true)}
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
        <div className="pi-chat-attachments" ref={setAttachmentList} />
        <Textarea
          aria-label={t('Chat.message')}
          placeholder={t('Chat.placeholder')}
          value={draft}
          disabled={sending || !panels.draftsReady}
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
          <div className="pi-chat-voice-status" ref={setVoiceStatus} />
          {
            <ReferenceAttachments
              value={references}
              onChange={setReferences}
              disabled={sending || !panels.draftsReady}
              retainOnUnmount
              compact
              listContainer={attachmentList}
            />
          }
          <VoiceInput
            statusContainer={voiceStatus}
            disabled={sending || !panels.draftsReady}
            onText={(text) => {
              const previous = panels.drafts.get(key) ?? '';
              updateDraft(
                (previous + (previous && !/\s$/.test(previous) ? ' ' : '') + text).slice(0, 200000),
              );
            }}
          />
          <IconButton
            title={state?.working ? t('Chat.enqueue') : t('Chat.send')}
            disabled={!ready || !panels.draftsReady || !draft.trim()}
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
    </FileDropZone>
  );
}
