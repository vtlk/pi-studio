import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button, IconButton } from '@/shared/ui';
import { useEditorDocument } from '../model/Editor';
import { durationFrames, type DemoTimeline } from '../model/timeline';
import { TimelineTracks } from './TimelineTracks';

export function EditorPrototype({
  documentKey,
  name,
  initial,
  scope = 'film',
  onClose,
}: {
  documentKey: string;
  name: string;
  initial: DemoTimeline;
  scope?: 'scene' | 'film';
  onClose: () => void;
}) {
  const { document, update } = useEditorDocument(documentKey, initial);
  const [fullscreen, setFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const total = durationFrames(document.timeline);
  const { timeline, frame } = document;
  const track = timeline.tracks.find((item) =>
    item.clips.some((clip) => clip.id === document.selectedClip),
  );
  const selected = track?.clips.find((clip) => clip.id === document.selectedClip);
  const preview = timeline.tracks[0]?.clips.find(
    (clip) => clip.start <= frame && clip.start + clip.duration > frame,
  );
  const accepted = document.acceptedRevision === document.revision;
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      update((previous) => ({
        ...previous,
        frame: (previous.frame + 1) % durationFrames(previous.timeline),
      }));
    }, 1000 / timeline.fps);
    return () => window.clearInterval(timer);
  }, [playing, timeline.fps, update]);
  const setFrame = (next: number) =>
    update((previous) => ({ ...previous, frame: Math.max(0, Math.min(total - 1, next)) }));
  return (
    <section
      className={`editor-prototype${fullscreen ? ' editor-fullscreen' : ''}`}
      aria-label="Макет просмотра монтажа"
    >
      <header className="editor-toolbar">
        <div>
          <strong>{name}</strong>
          <small>
            Просмотр монтажа · макет · v{document.revision} · {accepted ? 'Принята' : 'Не принята'}
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
            <div className="editor-canvas">
              {preview?.src ? (
                <img src={preview.src} alt={preview.label} />
              ) : (
                <p>Кадр без изображения</p>
              )}
              <span className="editor-subtitles">{timeline.subtitles.toUpperCase()}</span>
            </div>
          </div>
          <div className="editor-playback">
            <IconButton title="На кадр назад" onClick={() => setFrame(frame - 1)}>
              <SkipBack size={17} />
            </IconButton>
            <IconButton
              title={playing ? 'Пауза макета' : 'Воспроизвести макет'}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </IconButton>
            <IconButton title="На кадр вперёд" onClick={() => setFrame(frame + 1)}>
              <SkipForward size={17} />
            </IconButton>
            <label className="editor-scrubber">
              <span>
                {frame} / {total - 1} кадров
              </span>
              <input
                aria-label="Позиция монтажного просмотра"
                type="range"
                min="0"
                max={total - 1}
                value={Math.min(frame, total - 1)}
                onChange={(event) => setFrame(Number(event.target.value))}
              />
            </label>
            <small>1080 × 1920 · 30 fps</small>
          </div>
          <TimelineTracks
            timeline={timeline}
            selected={document.selectedClip}
            frame={frame}
            onSelect={(selectedClip) => update((previous) => ({ ...previous, selectedClip }))}
          />
        </div>
        <aside className="editor-inspector">
          <h3>Свойства клипа</h3>
          {selected && (
            <>
              <p>{selected.label}</p>
              <dl className="data-list">
                <dt>Начало, кадры</dt>
                <dd>{selected.start}</dd>
                <dt>Длительность, кадры</dt>
                <dd>{selected.duration}</dd>
              </dl>
            </>
          )}
          {track && (
            <dl className="data-list">
              <dt>Громкость дорожки</dt>
              <dd>{track.gain}%</dd>
              <dt>Панорама</dt>
              <dd>{track.pan}</dd>
            </dl>
          )}
          <h3>Субтитры</h3>
          <p>{timeline.subtitles}</p>
          <p className="subtle">Правки монтажа выполняются через диалог агента в Pi.</p>
          <p className="subtle">
            Просмотр статичных примеров. Воспроизведение видео, звука и ключевые кадры не
            подключены.
          </p>
        </aside>
      </div>
      <footer className="editor-footer">
        <Button
          kind="primary"
          onClick={() =>
            update((previous) => ({
              ...previous,
              acceptedRevision: accepted ? null : previous.revision,
            }))
          }
        >
          {accepted
            ? 'Отменить принятие'
            : scope === 'scene'
              ? 'Принять сцену'
              : 'Принять общую версию'}
        </Button>
      </footer>
    </section>
  );
}
