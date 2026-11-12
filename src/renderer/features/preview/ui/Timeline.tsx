import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/Project';
import { usePlayback } from '@/features/preview/model/Playback';
import { AudioLines, ExternalLink, Eye, Image, Layers3, Mic, UserRound } from 'lucide-react';
import { cx, timecode, Badge } from '@/shared/ui';

export function Timeline({ full = false }: { full?: boolean }) {
  const { demo } = useNotice();
  const { currentScene, selectedLocation, totalDuration } = useProject();
  const { scrub, layers, setLayers } = usePlayback();
  return (
    <div className="timeline">
      <div className="timeline-head">
        <div className="inline">
          <Layers3 size={14} />
          <strong>{full ? 'Монтаж мультфильма' : 'Слои сцены'}</strong>
          <Badge>Макет</Badge>
        </div>
        <button
          className="text-button"
          onClick={() => demo('Откроется Remotion Studio с выбранной композицией. Пока это макет.')}
        >
          <ExternalLink size={13} />
          Открыть Studio
        </button>
      </div>
      <div className="ruler">
        <span>СЛОИ</span>
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
            <span>{label}</span>
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
                      ? '«Это ещё что такое?»'
                      : i === 3
                        ? 'Двор · ветер и далёкий город'
                        : 'Стук в ящике'}
                  </span>
                </>
              ) : (
                <>
                  {full
                    ? 'Находка  /  Странный стук  /  Нежданный совет'
                    : i === 0
                      ? 'Механик · спокойствие → удивление'
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
