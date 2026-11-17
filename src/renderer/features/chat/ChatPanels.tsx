import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatTarget } from '../../../shared/chat';
import { t } from '../../../shared/i18n';
import { useStorage } from '@/shared/storage/Storage';
import { ChatPanelsContext } from './ChatPanels.context';
import type { ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';

export function ChatPanelsProvider({ children }: { children: ReactNode }) {
  const { saveNow, bootstrap } = useStorage();
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string[]>([]);
  const pending = useRef(new Map<string, Promise<void>>());
  const drafts = useRef(new Map<string, string>());
  const attachments = useRef(new Map<string, ReferenceAttachment[]>());
  const [, updateDrafts] = useState(0);
  useEffect(() => window.studio?.onChatOpened(setTarget), []);
  useEffect(() => {
    setTarget(null);
  }, [bootstrap?.folder]);
  const hasDraft =
    [...drafts.current.values()].some((text) => text.length > 0) ||
    [...attachments.current.values()].some((files) => files.length > 0);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDraft) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDraft]);
  const open = (next: ChatTarget, autoContinue = false) => {
    setTarget(next);
    const key = `${next.projectId}/${next.agentId}`;
    const current = pending.current.get(key);
    if (current) return current;
    setErrors((previous) => ({ ...previous, [key]: '' }));
    setOpening((previous) => [...previous, key]);
    const action = (async () => {
      try {
        if (!window.studio) throw new Error(t('Chat.desktopOnly'));
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
        show: setTarget,
        hide: () => setTarget(null),
        hideFor: (target) =>
          setTarget((current) =>
            current?.projectId === target.projectId && current.agentId === target.agentId
              ? null
              : current,
          ),
        error: errors[key] ?? '',
        opening: opening.includes(key),
        drafts: drafts.current,
        attachments: attachments.current,
        draftScope: bootstrap?.folder ?? '',
        setDraft: (key, text) => {
          drafts.current.set(key, text);
          updateDrafts((value) => value + 1);
        },
        setAttachments: (key, files) => {
          attachments.current.set(key, files);
          updateDrafts((value) => value + 1);
        },
      }}
    >
      {children}
      <span hidden data-unsaved-draft={hasDraft || undefined} />
    </ChatPanelsContext.Provider>
  );
}
