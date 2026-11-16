import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, SkipBack, SkipForward } from 'lucide-react';
import { Player, type PlayerRef, type CallbackListener } from '@remotion/player';
import type { ValidatedVideoProject } from '../../../../shared/video';
import { Button, IconButton } from '@/shared/ui';
import { readVideoView, rememberVideoView } from '../model/viewState';
import { VideoComposition } from '../player/VideoComposition';
import { remotionMuteControl, renderRemotionPlay } from './RemotionControls';
import { TimelineTrack } from './TimelineTrack';
import { ClipProperties } from './ClipProperties';
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
  useTranslation(undefined, { i18n });
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
      aria-label={t('VideoViewer.montageViewer')}
    >
      <header className="editor-toolbar">
        <div>
          <strong>{document.manifest.name}</strong>
          <small>
            Remotion Player ·{' '}
            {document.manifest.scope === 'scene'
              ? t('VideoViewer.scene')
              : t('VideoViewer.fullAssembly')}
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
                    title={t('EditorPrototype.previousFrame')}
                    onClick={() => seek((player.current?.getCurrentFrame() ?? 0) - 1)}
                  >
                    <SkipBack size={17} />
                  </IconButton>
                  <IconButton
                    className="remotion-step-control"
                    title={t('EditorPrototype.nextFrame')}
                    onClick={() => seek((player.current?.getCurrentFrame() ?? 0) + 1)}
                  >
                    <SkipForward size={17} />
                  </IconButton>
                </div>
              )}
              errorFallback={({ error }) => (
                <p className="error-message" role="alert">
                  {t('VideoViewer.couldNotPlayTheMontage')}
                  {error.message}
                </p>
              )}
            />
          </div>
          <div className="native-montage-metadata">
            <span aria-live="off" data-video-frame={view.frame}>
              {view.frame} / {total - 1} {t('EditorPrototype.frames')}
            </span>
            <small>
              {timeline.width} × {timeline.height} · {timeline.fps} fps
            </small>
          </div>
          <div className="editor-timeline" aria-label={t('VideoViewer.montageTimeline')}>
            <div className="editor-ruler">
              <span>00:00</span>
              <span>
                {(total / timeline.fps).toFixed(2)} {t('NativeMontageCard.s')}
              </span>
            </div>
            {timeline.tracks.map((track) => (
              <TimelineTrack
                key={track.id}
                track={track}
                total={total}
                frame={view.frame}
                selected={view.selected}
                onSelect={(id) => setView((previous) => ({ ...previous, selected: id }))}
              />
            ))}
          </div>
        </div>
        <ClipProperties selected={selected} assets={document.assets} />
      </div>
    </section>
  );
}
