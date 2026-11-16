import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/Project';
import { usePlayback } from '@/features/preview/model/Playback';
import { AudioLines, ExternalLink, Eye, Image, Layers3, Mic, UserRound } from 'lucide-react';
import { cx, timecode, Badge } from '@/shared/ui';

export function Timeline({ full = false }: { full?: boolean }) {
  useTranslation(undefined, { i18n });
  const { demo } = useNotice();
  const { currentScene, selectedLocation, totalDuration } = useProject();
  const { scrub, layers, setLayers } = usePlayback();
  return (
    <div className="timeline">
      <div className="timeline-head">
        <div className="inline">
          <Layers3 size={14} />
          <strong>{full ? t('Timeline.montage') : t('Timeline.sceneLayers')}</strong>
          <Badge>{t('Timeline.prototype')}</Badge>
        </div>
        <button
          className="text-button"
          onClick={() => demo(t('Timeline.remotionStudioWillOpenWithTheSelected'))}
        >
          <ExternalLink size={13} />
          {t('Timeline.openStudio')}
        </button>
      </div>
      <div className="ruler">
        <span>{t('Timeline.layers')}</span>
        <div>
          {[
            '00:00',
            '00:03',
            '00:06',
            '00:09',
            timecode(full ? totalDuration : currentScene.duration),
          ].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
      {(full
        ? ['Сцены', 'Речь', 'Атмосфера', 'Музыка']
        : ['Персонажи', 'Окружение', 'Речь', 'Атмосфера', 'Эффекты']
      ).map((label, i) => (
        <div className="track" key={label}>
          <button
            className="track-label"
            onClick={() =>
              setLayers((prev) =>
                prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
              )
            }
          >
            {label === 'Речь' ? (
              <Mic size={12} />
            ) : label === 'Персонажи' ? (
              <UserRound size={12} />
            ) : label === 'Окружение' ? (
              <Image size={12} />
            ) : (
              <AudioLines size={12} />
            )}
            <span>
              {t(
                (
                  {
                    Сцены: 'Timeline.scenes',
                    Речь: 'Playback.speech',
                    Атмосфера: 'Playback.ambience',
                    Музыка: 'Timeline.music',
                    Персонажи: 'Playback.characters',
                    Окружение: 'Playback.environment',
                    Эффекты: 'Playback.effects',
                  } as const
                )[label as 'Сцены'],
              )}
            </span>
            <Eye size={12} className={cx(!layers.includes(label) && 'faded')} />
          </button>
          <div className={cx('track-content', !layers.includes(label) && 'track-muted')}>
            <div
              className={`clip clip-${i}`}
              style={{
                marginLeft: `${i === 2 ? 15 : i === 4 ? 65 : 0}%`,
                width: `${i === 2 ? 45 : i === 4 ? 22 : 96}%`,
              }}
            >
              {i > 1 ? (
                <>
                  <span className="waveform">
                    {Array.from({ length: 65 }, (_, k) => (
                      <i key={k} style={{ height: `${3 + ((k * 17 + 9) % 19)}px` }} />
                    ))}
                  </span>
                  <span>
                    {i === 2
                      ? t('Timeline.whatIsThis')
                      : i === 3
                        ? t('Timeline.courtyardWindAndDistantCity')
                        : t('Timeline.knockingInsideTheCrate')}
                  </span>
                </>
              ) : (
                <>
                  {full
                    ? t('Timeline.discoveryStrangeKnockingUnexpectedAdvice')
                    : i === 0
                      ? t('Timeline.mechanicCalmSurprise')
                      : selectedLocation.title}
                </>
              )}
            </div>
          </div>
        </div>
      ))}
      <div
        className="playhead"
        style={{
          left: `calc(130px + (100% - 150px) * ${scrub / (full ? totalDuration : currentScene.duration)})`,
        }}
      />
    </div>
  );
}
