import { getStudioApi } from '@/shared/desktopApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageConnectionStatus } from '../../../../shared/connections';

export function useImageConnections(ids: string[], folder?: string) {
  const [statuses, setStatuses] = useState<Record<string, ImageConnectionStatus>>({});
  const signature = JSON.stringify(ids);
  const currentFolder = useRef(folder);
  currentFolder.current = folder;
  const refresh = useCallback(
    async (id: string) => {
      if (!window.studio || !folder) return;
      const result = await window.studio.readImageConnection({ folder, connectionId: id });
      if (currentFolder.current !== folder) return;
      setStatuses((previous) => ({ ...previous, [id]: result }));
      return result;
    },
    [folder],
  );
  useEffect(() => {
    if (!window.studio || !folder) return;
    let active = true;
    const read = async () => {
      const next = await Promise.all(
        (JSON.parse(signature) as string[]).map(async (id) => {
          try {
            return [
              id,
              await getStudioApi().readImageConnection({ folder, connectionId: id }),
            ] as const;
          } catch {
            return undefined;
          }
        }),
      );
      if (active) setStatuses(Object.fromEntries(next.filter((entry) => entry !== undefined)));
    };
    void read();
    const focus = () => void read();
    window.addEventListener('focus', focus);
    const timer = setInterval(() => {
      if (!document.hidden) void read();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [signature, folder]);
  return { imageStatuses: statuses, refreshImageConnection: refresh };
}
