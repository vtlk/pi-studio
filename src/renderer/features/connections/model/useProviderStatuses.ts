import { useCallback, useEffect, useState } from 'react';
import type { ProviderStatus } from '../../../../shared/contracts';

export function useProviderStatuses(providerIds: string[], scope: string) {
  const key = JSON.stringify([...new Set(providerIds.filter(Boolean))].sort());
  const [providerStatuses, setStatuses] = useState<
    Record<string, ProviderStatus['status'] | 'checking' | 'unavailable'>
  >({});
  const setProviderStatus = useCallback(
    (result: ProviderStatus) =>
      setStatuses((previous) =>
        previous[result.provider] === result.status
          ? previous
          : { ...previous, [result.provider]: result.status },
      ),
    [],
  );
  useEffect(() => {
    if (!window.studio) return;
    let active = true,
      busy = false;
    const ids = JSON.parse(key) as string[];
    setStatuses(Object.fromEntries(ids.map((id) => [id, 'checking'])));
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        await Promise.all(
          ids.map(async (id) => {
            try {
              const result = await window.studio!.getProviderStatus(id);
              if (active) setProviderStatus(result);
            } catch {
              if (active) setStatuses((previous) => ({ ...previous, [id]: 'unavailable' }));
            }
          }),
        );
      } finally {
        busy = false;
      }
    };
    void refresh();
    const focus = () => void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [key, scope, setProviderStatus]);
  return { providerStatuses, setProviderStatus };
}
