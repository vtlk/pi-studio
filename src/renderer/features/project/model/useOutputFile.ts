import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { OutputFile } from './workspace.types';

export function useOutputFile(projectId: string | undefined, selected: OutputFile | undefined) {
  useTranslation(undefined, { i18n });
  const [result, setResult] = useState<{ key: string; file?: OutputFile; error?: string }>();
  const key = `${projectId}:${selected?.diskPath}:${selected?.fingerprint}`;
  const path = selected?.diskPath;
  useEffect(() => {
    if (!window.studio || !projectId || !path) return;
    let active = true;
    void window.studio.readOutput({ projectId, path }).then(
      (file) => {
        if (active) setResult({ key, file });
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            error: error instanceof Error ? error.message : t('useOutputFile.couldNotReadTheFile'),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, path, key]);
  if (!path) return { file: selected, loading: false, error: undefined };
  return {
    file: result?.key === key ? result.file : undefined,
    loading: result?.key !== key,
    error: result?.key === key ? result.error : undefined,
  };
}
