import { useRef, useState } from 'react';
import type { ChatQueueAction, ChatState, ChatTarget } from '../../../shared/chat';
import { t } from '../../../shared/i18n';
import type { ChatPanelsValue } from './ChatPanels.context';

export function useQueueActions(
  target: ChatTarget,
  state: ChatState | null,
  panels: ChatPanelsValue,
  key: string,
  onError: (message: string) => void,
  onEdited?: () => void,
) {
  const [busy, setBusy] = useState('');
  const active = useRef(false);
  const act = async (entryId: string, action: ChatQueueAction['action']) => {
    if (active.current || !state || !window.studio) return;
    active.current = true;
    setBusy(entryId);
    onError('');
    try {
      if (action === 'edit' && !(await panels.flushDrafts(key)))
        throw Error(t('ChatDrafts.saveFailed'));
      const before = panels.currentDraft(key);
      const result = await window.studio.changeChatQueue({
        ...target,
        runId: state.runId,
        entryId,
        action,
        ...(action === 'edit'
          ? {
              maxTextLength: Math.max(0, 200000 - before.text.length - (before.text ? 2 : 0)),
              maxAttachments: Math.max(0, 32 - before.attachments.length),
            }
          : {}),
      });
      if (action === 'edit' && typeof result.text === 'string') {
        const current = panels.currentDraft(key);
        // Preserve existing/newer draft input and attachments; never submit the restored message.
        panels.setDraft(key, current.text + (current.text ? '\n\n' : '') + result.text);
        panels.setAttachments(key, [...current.attachments, ...(result.attachments ?? [])]);
        if (!(await panels.flushDrafts(key))) throw Error(t('ChatDrafts.saveFailed'));
        onEdited?.();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t('Chat.commandFailed'));
    } finally {
      active.current = false;
      setBusy('');
    }
  };
  return { busy, act };
}
