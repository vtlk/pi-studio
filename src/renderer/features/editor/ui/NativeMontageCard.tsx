import { useState } from 'react';
import type { VideoProjectInspection } from '../../../../shared/video';
import { Button } from '@/shared/ui';
import { VideoViewer } from './VideoViewer';

export function NativeMontageCard({
  result,
  documentKey,
}: {
  result: VideoProjectInspection | undefined;
  documentKey: string;
}) {
  const [open, setOpen] = useState(false);
  if (!result) return <p role="status">Проверяем монтаж и материалы…</p>;
  if (!result.ok)
    return (
      <section className="montage-card">
        <h2>Монтаж недоступен</h2>
        <p role="alert" className="error-message">
          {result.error}
        </p>
      </section>
    );
  const { document } = result;
  if (open)
    return (
      <VideoViewer
        key={document.revision}
        document={document}
        documentKey={documentKey}
        onClose={() => setOpen(false)}
      />
    );
  const { timeline, manifest } = document;
  return (
    <section className="montage-card">
      <h2>Монтажный проект</h2>
      <p>{manifest.name}</p>
      <dl className="data-list">
        <dt>Размер</dt>
        <dd>
          {timeline.width} × {timeline.height}
        </dd>
        <dt>Частота</dt>
        <dd>{timeline.fps} fps</dd>
        <dt>Длительность</dt>
        <dd>{(timeline.durationInFrames / timeline.fps).toFixed(2)} с</dd>
        <dt>Материалы</dt>
        <dd>{document.assets.length}</dd>
      </dl>
      <Button kind="primary" onClick={() => setOpen(true)}>
        Открыть монтаж
      </Button>
    </section>
  );
}
