import { useLayoutEffect, useRef, useState } from 'react';
import { Expand, Grip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n, t } from '../../../../shared/i18n';
import type { OutputFile } from '../model/workspace.types';
import { Tooltip } from '@/shared/ui/Tooltip';

/** The stage owns the bounds; resizing never replaces the playing video element. */
export function Mp4Preview({ file }: { file: OutputFile }) {
  useTranslation(undefined, { i18n });
  const stage = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const [requested, setRequested] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const element = stage.current!;
    const observer = new ResizeObserver(() => {
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, Math.min(bounds.width, Math.max(0, bounds.height - 24) * ratio));
  const width = requested === null ? max : Math.min(max, Math.max(64, requested));
  return (
    <section className="mp4-preview">
      <div className="mp4-preview-toolbar">
        <Tooltip label={t('Mp4Preview.fit')}>
          <button type="button" aria-label={t('Mp4Preview.fit')} onClick={() => setRequested(null)}>
            <Expand size={16} />
          </button>
        </Tooltip>
      </div>
      <div className="mp4-preview-stage" ref={stage}>
        <div
          className="mp4-preview-player"
          style={{ width, visibility: max ? 'visible' : 'hidden' }}
        >
          <video
            controls
            src={file.src}
            aria-label={file.name}
            style={{ width: '100%', height: width / ratio }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth && video.videoHeight)
                setRatio(video.videoWidth / video.videoHeight);
            }}
            onError={() => setFailed(true)}
          />
          <Tooltip label={t('Mp4Preview.resize')}>
            <button
              type="button"
              className="mp4-preview-resize"
              aria-label={t('Mp4Preview.resize')}
              onPointerDown={(event) => {
                event.preventDefault();
                drag.current = { x: event.clientX, y: event.clientY, width };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                const start = drag.current;
                const dx = event.clientX - start.x,
                  dy = (event.clientY - start.y) * ratio;
                const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
                setRequested(Math.min(max, Math.max(Math.min(64, max), start.width + delta)));
              }}
              onPointerUp={(event) => {
                drag.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                if (
                  ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home'].includes(event.key)
                ) {
                  event.preventDefault();
                  setRequested(
                    event.key === 'Home'
                      ? null
                      : Math.min(
                          max,
                          Math.max(
                            64,
                            width + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -32 : 32),
                          ),
                        ),
                  );
                }
              }}
            >
              <Grip size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
      {failed && (
        <p className="error-message" role="alert">
          {t('OutputPreview.couldNotPlayTheVideoCheckFile')}
        </p>
      )}
    </section>
  );
}
