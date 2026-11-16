import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  useTranslation(undefined, { i18n });
  const [open, setOpen] = useState(false);
  if (!result) return <p role="status">{t('NativeMontageCard.checkingMontageAndAssets')}</p>;
  if (!result.ok)
    return (
      <section className="montage-card">
        <h2>{t('NativeMontageCard.montageUnavailable')}</h2>
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
      <h2>{t('MontageCard.montageProject')}</h2>
      <p>{manifest.name}</p>
      <dl className="data-list">
        <dt>{t('MontageCard.size')}</dt>
        <dd>
          {timeline.width} × {timeline.height}
        </dd>
        <dt>{t('MontageCard.frameRate')}</dt>
        <dd>{timeline.fps} fps</dd>
        <dt>{t('NativeMontageCard.duration')}</dt>
        <dd>
          {(timeline.durationInFrames / timeline.fps).toFixed(2)} {t('NativeMontageCard.s')}
        </dd>
        <dt>{t('NativeMontageCard.assets')}</dt>
        <dd>{document.assets.length}</dd>
      </dl>
      <Button kind="primary" onClick={() => setOpen(true)}>
        {t('MontageCard.openMontage')}
      </Button>
    </section>
  );
}
