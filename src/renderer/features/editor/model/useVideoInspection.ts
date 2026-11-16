import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { VideoProjectInspection } from '../../../../shared/video';

export function useVideoInspection(
  projectId: string | undefined,
  path: string | undefined,
  filesVersion: string,
) {
  useTranslation(undefined, { i18n });
  const [result, setResult] = useState<{ key: string; value: VideoProjectInspection }>();
  const key = `${projectId}:${path}`;
  useEffect(() => {
    if (!window.studio || !projectId || !path) return;
    let active = true;
    void window.studio.inspectVideoProject({ projectId, path }).then(
      (value) => {
        if (active)
          setResult((previous) => ({
            key,
            value:
              previous?.key === key &&
              previous.value.ok &&
              value.ok &&
              previous.value.document.revision === value.document.revision
                ? previous.value
                : value,
          }));
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            value: {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : t('useVideoInspection.couldNotReadTheMontage'),
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, path, key, filesVersion]);
  return result?.key === key ? result.value : undefined;
}
