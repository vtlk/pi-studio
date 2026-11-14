import { useEffect, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';

/** Poll only live counts; opening the list never rescans project files or starts Pi. */
export function useProjectActivity() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!window.studio) return;
    let active = true,
      reading = false;
    const refresh = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const data = await getStudioApi().listProjectActivity();
        if (!active) return;
        const next = Object.fromEntries(data.map((item) => [item.projectId, item.runningAgents]));
        setCounts((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
        setUnavailable(false);
      } catch {
        if (active) {
          setCounts({});
          setUnavailable(true);
        }
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    const focused = () => {
      void refresh();
    };
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
    };
  }, []);
  return { counts, unavailable };
}
