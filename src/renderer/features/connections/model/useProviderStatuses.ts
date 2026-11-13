import { useCallback, useEffect, useState } from 'react';
import type { Connection, ModelConnectionStatus } from '../../../../shared/connections';

export function useProviderStatuses(connections: Connection[], scope: string, folder?: string) {
  const key = JSON.stringify(
    connections
      .map((item) => [item.id, item.providerId, item.authScope, item.endpoint, item.endpointConfig])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const [providerStatuses, setStatuses] = useState<
    Record<string, ModelConnectionStatus['status'] | 'checking' | 'unavailable'>
  >({});
  const setProviderStatus = useCallback(
    (result: ModelConnectionStatus) =>
      setStatuses((previous) =>
        previous[result.connectionId] === result.status
          ? previous
          : { ...previous, [result.connectionId]: result.status },
      ),
    [],
  );
  useEffect(() => {
    if (!window.studio || !folder) return;
    let active = true,
      busy = false;
    const ids = (JSON.parse(key) as string[][]).map((item) => item[0]);
    setStatuses(Object.fromEntries(ids.map((id) => [id, 'checking'])));
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        await Promise.all(
          ids.map(async (id) => {
            try {
              const result = await window.studio!.getConnectionStatus({ folder, connectionId: id });
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
  }, [key, scope, folder, setProviderStatus]);
  return { providerStatuses, setProviderStatus };
}
