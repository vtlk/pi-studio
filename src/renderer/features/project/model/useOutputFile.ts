import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import type { OutputFile } from './workspace.types';
import { OutputReadQueue } from './OutputReadQueue';

export function useOutputFile(projectId: string | undefined, selected: OutputFile | undefined) {
  useTranslation(undefined, { i18n });
  const [result, setResult] = useState<{ identity: string; file?: OutputFile; error?: string }>();
  const path = selected?.diskPath;
  const identity = `${projectId}:${path}`;
  const reader = useRef<OutputReadQueue<OutputFile>>(undefined);
  useEffect(() => {
    if (!window.studio || !projectId || !path) return;
    const api = window.studio;
    const queue = new OutputReadQueue(
      () => api.readOutput({ projectId, path }),
      (file, error) => {
        setResult({
          identity,
          file,
          error: error
            ? error instanceof Error
              ? error.message
              : t('useOutputFile.couldNotReadTheFile')
            : undefined,
        });
      },
    );
    reader.current = queue;
    return () => {
      queue.close();
      if (reader.current === queue) reader.current = undefined;
    };
  }, [projectId, path, identity]);
  useEffect(() => {
    reader.current?.request(selected?.fingerprint ?? '');
  }, [identity, selected?.fingerprint]);
  if (!path) return { file: selected, loading: false, error: undefined };
  const current = result?.identity === identity ? result : undefined;
  return { file: current?.file, loading: !current, error: current?.error };
}
