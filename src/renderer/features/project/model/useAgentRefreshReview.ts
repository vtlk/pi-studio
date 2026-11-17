import { useEffect, useState } from 'react';
import type { AgentRefreshReview } from '../../../../shared/agentRefresh';
import { t } from '../../../../shared/i18n';

export function useAgentRefreshReview(projectId: string | undefined, updateExisting: boolean) {
  const [review, setReview] = useState<AgentRefreshReview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      reading = false;
    const read = async () => {
      if (!projectId || !window.studio || reading) return;
      reading = true;
      try {
        const next = await window.studio.prepareAgentRefresh({ projectId, updateExisting });
        if (active) {
          setReview(next);
          setError('');
        }
      } catch (error) {
        if (active)
          setError(error instanceof Error ? error.message : t('AgentRefresh.invalidRequest'));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, updateExisting]);
  return { review, error };
}
