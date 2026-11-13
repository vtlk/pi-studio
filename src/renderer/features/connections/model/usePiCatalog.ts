import { useCallback, useEffect, useRef, useState } from 'react';
import type { PiModelCatalog } from '../../../../shared/models';
import type { Connection } from '../../../../shared/connections';
import { useStorage } from '@/shared/storage/Storage';

export function usePiCatalog(connection?: Connection) {
  const { bootstrap } = useStorage();
  const scope = JSON.stringify([bootstrap?.folder, bootstrap?.sections.piPath, connection]);
  const [result, setResult] = useState<{ scope: string; catalog?: PiModelCatalog }>();
  const sequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!window.studio) return;
      const current = ++sequence.current;
      const [folder, , selected] = JSON.parse(scope) as [
        string | undefined,
        unknown,
        Connection | null,
      ];
      setLoading(true);
      try {
        const catalog = await window.studio.getModelCatalog(
          selected && folder ? { folder, connectionId: selected.id } : undefined,
        );
        if (sequence.current !== current || signal?.aborted) return;
        setResult({ scope, catalog });
        setError('');
      } catch (error) {
        if (sequence.current !== current || signal?.aborted) return;
        setResult({ scope });
        setError(error instanceof Error ? error.message : 'Каталог Pi недоступен.');
      } finally {
        if (sequence.current === current && !signal?.aborted) setLoading(false);
      }
    },
    [scope],
  );
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return { catalog: result?.scope === scope ? result.catalog : undefined, loading, error, reload };
}
