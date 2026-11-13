import { useEffect, useState } from 'react';
import type { VideoProjectInspection } from '../../../../shared/video';

export function useVideoInspection(
  projectId: string | undefined,
  path: string | undefined,
  filesVersion: string,
) {
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
              error: error instanceof Error ? error.message : 'Не удалось прочитать монтаж.',
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
