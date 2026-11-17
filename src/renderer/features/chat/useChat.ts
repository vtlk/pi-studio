import { useEffect, useState } from 'react';
import type { ChatState, ChatTarget } from '../../../shared/chat';
import { t } from '../../../shared/i18n';

export function useChat(target: ChatTarget) {
  const [state, setState] = useState<ChatState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const request = { projectId: target.projectId, agentId: target.agentId };
    let alive = true,
      reading = false,
      again = false;
    const read = async () => {
      if (reading) {
        again = true;
        return;
      }
      if (!window.studio) {
        setError(t('Chat.desktopOnly'));
        return;
      }
      reading = true;
      try {
        do {
          again = false;
          const next = await window.studio.getChat(request);
          if (!alive) return;
          setState((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
          setError('');
        } while (again && alive);
      } catch (error) {
        if (alive) setError(error instanceof Error ? error.message : t('Chat.disconnected'));
      } finally {
        reading = false;
      }
    };
    const unsubscribe = window.studio?.onChatChanged((next) => {
      if (next.projectId === target.projectId && next.agentId === target.agentId) void read();
    });
    void read();
    const timer = setInterval(() => {
      if (!document.hidden) void read();
    }, 1500);
    return () => {
      alive = false;
      unsubscribe?.();
      clearInterval(timer);
    };
  }, [target.projectId, target.agentId]);
  return { state, error };
}
