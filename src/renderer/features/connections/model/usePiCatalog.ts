import { useCallback, useEffect, useState } from 'react';
import type { PiModelCatalog } from '../../../../shared/models';

export function usePiCatalog() {
  const [catalog, setCatalog] = useState<PiModelCatalog>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!window.studio) return;
    setLoading(true);
    try {
      setCatalog(await window.studio.getModelCatalog());
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Каталог Pi недоступен.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { catalog, loading, error, reload };
}
