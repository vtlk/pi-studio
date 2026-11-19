import { ChatDraftStore } from './ChatDraftStore';
import { Button } from '@/shared/ui';
import { VoiceDraftGuard } from '@/features/voice/VoiceDraftGuard';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatTarget } from '../../../shared/chat';
import { t } from '../../../shared/i18n';
import { useStorage } from '@/shared/storage/Storage';
import { ChatPanelsContext } from './ChatPanels.context';

export function ChatPanelsProvider({ children }: { children: ReactNode }) {
  const { saveNow, bootstrap } = useStorage();
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string[]>([]);
  const pending = useRef(new Map<string, Promise<void>>());
  const selection = useRef(0);
  const show = (next: ChatTarget | null) => {
    selection.current++;
    setTarget(next);
  };
  const [draftStore] = useState(() => new ChatDraftStore(window.studio));
  useSyncExternalStore(draftStore.subscribe, draftStore.snapshot);
  const folder = bootstrap?.folder ?? '';
  useEffect(() => {
    if (folder) void draftStore.load(folder);
  }, [draftStore, folder]);
  useEffect(
    () =>
      window.studio?.onChatDraftConsumed((change) => {
        draftStore.consumed(change);
      }),
    [draftStore],
  );
  useEffect(
    () =>
      window.studio?.onChatOpened((next) => {
        selection.current++;
        setTarget(next);
      }),
    [],
  );
  useEffect(() => {
    selection.current++;
    setTarget(null);
  }, [bootstrap?.folder]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!draftStore.unsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draftStore]);
  const open = (next: ChatTarget, autoContinue = false) => {
    show(next);
    const key = `${next.projectId}/${next.agentId}`;
    const current = pending.current.get(key);
    if (current) return current;
    setErrors((previous) => ({ ...previous, [key]: '' }));

    const action = (async () => {
      try {
        if (!window.studio) throw new Error(t('Chat.desktopOnly'));
        const existing = await window.studio.getChat(next);
        if (existing?.phase !== 'ready') setOpening((previous) => [...previous, key]);
        if (!(await saveNow()))
          throw new Error(t('useNativeWorkspaceState.saveCurrentSettingsChangesFirst'));
        if (next.projectId === 'pi-setup-assistant') await window.studio.openSetupAssistant();
        else await window.studio.launchAgent({ ...next, autoContinue });
      } catch (error) {
        setErrors((previous) => ({
          ...previous,
          [key]: error instanceof Error ? error.message : t('Chat.couldNotStart'),
        }));
      } finally {
        pending.current.delete(key);
        setOpening((previous) => previous.filter((item) => item !== key));
      }
    })();
    pending.current.set(key, action);
    return action;
  };
  const key = target ? `${target.projectId}/${target.agentId}` : '';
  return (
    <ChatPanelsContext.Provider
      value={{
        target,
        open,
        show,
        showRunning: (next) => {
          const revision = ++selection.current;
          let cancelled = false;
          // Metadata only: never launch, save, send input or probe the OS here.
          void window.studio
            ?.listPiProcesses()
            .then((processes) => {
              if (
                !cancelled &&
                selection.current === revision &&
                processes.some(
                  (process) =>
                    process.embedded &&
                    process.projectId === next.projectId &&
                    process.agentId === next.agentId,
                )
              )
                setTarget(next);
            })
            .catch(() => {});
          return () => {
            cancelled = true;
          };
        },
        hide: () => show(null),
        hideFor: (target) => {
          selection.current++;
          setTarget((current) =>
            current?.projectId === target.projectId && current.agentId === target.agentId
              ? null
              : current,
          );
        },
        error: errors[key] ?? '',
        opening: opening.includes(key),
        drafts: draftStore.drafts,
        attachments: draftStore.attachments,
        draftScope: folder,
        draftsReady: draftStore.ready(folder),
        flushDrafts: (key) => draftStore.flush(key),
        currentDraft: (key) => draftStore.current(key),
        draftSent: (key, revision, result) => draftStore.sent(key, revision, result),
        setDraft: (key, text) => draftStore.setText(key, text),
        setAttachments: (key, files) => draftStore.setAttachments(key, files),
      }}
    >
      {children}
      <VoiceDraftGuard />
      <span
        hidden
        data-chat-draft-error={(draftStore.unsaved() && !!draftStore.error()) || undefined}
        data-chat-draft-pending={draftStore.unsaved() || undefined}
        data-unsaved-draft={draftStore.unsaved() || undefined}
      />
      {draftStore.error() && (
        <div className="chat-draft-save-error" role="alert">
          <span>{draftStore.error()}</span>
          <Button onClick={() => void draftStore.retry()}>{t('ChatDrafts.retry')}</Button>
        </div>
      )}
    </ChatPanelsContext.Provider>
  );
}
