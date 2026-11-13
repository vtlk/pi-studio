import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, SkipBack, SkipForward } from 'lucide-react';
import { Player, type PlayerRef, type CallbackListener } from '@remotion/player';
import type { ValidatedVideoProject } from '../../../../shared/video';
import { Button, IconButton } from '@/shared/ui';
import { Tooltip } from '@/shared/ui/Tooltip';
import { readVideoView, rememberVideoView } from '../model/viewState';
import { VideoComposition } from '../player/VideoComposition';
import { remotionMuteControl, renderRemotionPlay } from './RemotionControls';
import { timelineLanes } from '../model/timelineLanes';
import './videoViewer.css';

export function VideoViewer({
  document,
  documentKey,
  onClose,
}: {
  document: ValidatedVideoProject;
  documentKey: string;
  onClose: () => void;
}) {
  const key = `${documentKey}:${document.revision}`;
  const [view, setView] = useState(() => readVideoView(key));
  const [fullscreen, setFullscreen] = useState(false);
  const player = useRef<PlayerRef>(null);
  const initialFrame = useRef(view.frame);
  const inputProps = useMemo(() => ({ document }), [document]);
  const muteControl = useMemo(() => remotionMuteControl(player), []);
  const { timeline } = document,
    total = timeline.durationInFrames;
  useEffect(() => {
    rememberVideoView(key, view);
  }, [key, view]);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const update: CallbackListener<'frameupdate'> = ({ detail }) =>
      setView((previous) =>
        previous.frame === detail.frame ? previous : { ...previous, frame: detail.frame },
      );
    current.addEventListener('frameupdate', update);
    return () => {
      current.removeEventListener('frameupdate', update);
      current.pause();
    };
  }, []);
  useEffect(() => {
    const visibility = () => {
      if (window.document.hidden) player.current?.pause();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        fullscreen &&
        !window.document.querySelector('[role="dialog"]')
      ) {
        event.stopPropagation();
        setFullscreen(false);
      }
    };
    window.document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', escape);
    return () => {
      window.document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', escape);
    };
  }, [fullscreen]);
  const seek = (frame: number) => {
    player.current?.pause();
    player.current?.seekTo(Math.max(0, Math.min(total - 1, frame)));
  };
  const selected = timeline.tracks
    .flatMap((track) => track.items)
    .find((item) => item.id === view.selected);
  return (
    <section
      className={`editor-prototype native-video-viewer${fullscreen ? ' editor-fullscreen' : ''}`}
      aria-label="Просмотр монтажа"
    >
      <header className="editor-toolbar">
        <div>
          <strong>{document.manifest.name}</strong>
          <small>
            Remotion Player · {document.manifest.scope === 'scene' ? 'сцена' : 'общая сборка'}
          </small>
        </div>
        <Button onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {fullscreen ? 'Вернуть в проект' : 'На весь экран'}
        </Button>
        <Button onClick={onClose}>Закрыть просмотр</Button>
      </header>
      <div className="editor-body">
        <div className="editor-main">
          <div className="editor-stage">
            <Player
              ref={player}
              className="studio-remotion-player"
              component={VideoComposition}
              inputProps={inputProps}
              durationInFrames={total}
              compositionWidth={timeline.width}
              compositionHeight={timeline.height}
              fps={timeline.fps}
              initialFrame={initialFrame.current}
              style={{ width: '100%', height: '100%' }}
              controls
              alwaysShowControls
              allowFullscreen={false}
              doubleClickToFullscreen={false}
              moveToBeginningWhenEnded={false}
              numberOfSharedAudioTags={0}
              renderPlayPauseButton={renderRemotionPlay}
              renderMuteButton={muteControl}
              renderCustomControls={() => (
                <div className="remotion-frame-controls">
                  <IconButton
                    className="remotion-step-control"
                    title="На кадр назад"
                    onClick={() => seek((player.current?.getCurrentFrame() ?? 0) - 1)}
                  >
                    <SkipBack size={17} />
                  </IconButton>
                  <IconButton
                    className="remotion-step-control"
                    title="На кадр вперёд"
                    onClick={() => seek((player.current?.getCurrentFrame() ?? 0) + 1)}
                  >
                    <SkipForward size={17} />
                  </IconButton>
                </div>
              )}
              errorFallback={({ error }) => (
                <p className="error-message" role="alert">
                  Не удалось воспроизвести монтаж: {error.message}
                </p>
              )}
            />
          </div>
          <div className="native-montage-metadata">
            <span aria-live="off" data-video-frame={view.frame}>
              {view.frame} / {total - 1} кадров
            </span>
            <small>
              {timeline.width} × {timeline.height} · {timeline.fps} fps
            </small>
          </div>
          <div className="editor-timeline" aria-label="Таймлайн монтажа">
            <div className="editor-ruler">
              <span>00:00</span>
              <span>{(total / timeline.fps).toFixed(2)} с</span>
            </div>
            {timeline.tracks.map((track) => {
              const layout = timelineLanes(track.items);
              return (
                <div className="editor-track" key={track.id}>
                  <Tooltip label={track.name}>
                    <div className="editor-track-name">
                      <span>{track.name}</span>
                    </div>
                  </Tooltip>
                  <div className="editor-track-clips" style={{ height: layout.count * 40 }}>
                    {track.items.map((item) => (
                      <Tooltip key={item.id} label={item.name}>
                        <button
                          className={`editor-clip${view.selected === item.id ? ' selected' : ''}`}
                          aria-label={`Клип ${item.name}`}
                          aria-pressed={view.selected === item.id}
                          onClick={() =>
                            setView((previous) => ({ ...previous, selected: item.id }))
                          }
                          style={{
                            left: `${(item.from / total) * 100}%`,
                            width: `${(item.duration / total) * 100}%`,
                            top: (layout.lanes.get(item.id) ?? 0) * 40 + 4,
                            height: 32,
                          }}
                        >
                          <span>{item.name}</span>
                        </button>
                      </Tooltip>
                    ))}
                    <div
                      className="editor-playhead"
                      style={{ left: `${(view.frame / total) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="editor-inspector">
          <h3>Свойства клипа</h3>
          {selected ? (
            <>
              <p>{selected.name}</p>
              <dl className="data-list">
                <dt>Начало, кадры</dt>
                <dd>{selected.from}</dd>
                <dt>Длительность, кадры</dt>
                <dd>{selected.duration}</dd>
                <dt>Громкость</dt>
                <dd>{Math.round((selected.volume ?? 1) * 100)}%</dd>
              </dl>
              {selected.text && (
                <>
                  <h3>Субтитры</h3>
                  <p>{selected.text.toUpperCase()}</p>
                </>
              )}
            </>
          ) : (
            <p>Выберите клип на таймлайне.</p>
          )}
          <p className="subtle">Правки монтажа выполняются в диалоге агента в Pi.</p>
        </aside>
      </div>
    </section>
  );
}
