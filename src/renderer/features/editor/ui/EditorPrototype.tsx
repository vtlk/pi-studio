import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  onClose,
}: {
  documentKey: string;
  name: string;
  initial: DemoTimeline;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
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
      aria-label={t('EditorPrototype.montageViewerPrototype')}
    >
      <header className="editor-toolbar">
        <div>
          <strong>{name}</strong>
          <small>
            {t('EditorPrototype.montageViewerPrototypeV')}
            {document.revision}
          </small>
        </div>
        <Button onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {fullscreen ? t('EditorPrototype.returnToProject') : t('EditorPrototype.fullScreen')}
        </Button>
        <Button onClick={onClose}>{t('EditorPrototype.closeViewer')}</Button>
      </header>
      <div className="editor-body">
        <div className="editor-main">
          <div className="editor-stage">
            <div className="editor-canvas">
              {preview?.src ? (
                <img src={preview.src} alt={preview.label} />
              ) : (
                <p>{t('EditorPrototype.frameWithoutAnImage')}</p>
              )}
              <span className="editor-subtitles">{timeline.subtitles.toUpperCase()}</span>
            </div>
          </div>
          <div className="editor-playback">
            <IconButton
              title={t('EditorPrototype.previousFrame')}
              onClick={() => setFrame(frame - 1)}
            >
              <SkipBack size={17} />
            </IconButton>
            <IconButton
              title={
                playing ? t('EditorPrototype.pausePrototype') : t('EditorPrototype.playPrototype')
              }
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </IconButton>
            <IconButton title={t('EditorPrototype.nextFrame')} onClick={() => setFrame(frame + 1)}>
              <SkipForward size={17} />
            </IconButton>
            <label className="editor-scrubber">
              <span>
                {frame} / {total - 1} {t('EditorPrototype.frames')}
              </span>
              <input
                aria-label={t('EditorPrototype.montageViewerPosition')}
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
          <h3>{t('ClipProperties.clipProperties')}</h3>
          {selected && (
            <>
              <p>{selected.label}</p>
              <dl className="data-list">
                <dt>{t('ClipProperties.startFrames')}</dt>
                <dd>{selected.start}</dd>
                <dt>{t('ClipProperties.durationFrames')}</dt>
                <dd>{selected.duration}</dd>
              </dl>
            </>
          )}
          {track && (
            <dl className="data-list">
              <dt>{t('EditorPrototype.trackVolume')}</dt>
              <dd>{track.gain}%</dd>
              <dt>{t('ClipProperties.pan')}</dt>
              <dd>{track.pan}</dd>
            </dl>
          )}
          <h3>{t('ClipProperties.subtitles')}</h3>
          <p>{timeline.subtitles}</p>
          <p className="subtle">{t('EditorPrototype.editTheMontageThroughTheAgentS')}</p>
          <p className="subtle">
            {t('EditorPrototype.staticExamplesVideoAudioAndKeyframePlayback')}
          </p>
        </aside>
      </div>
    </section>
  );
}
