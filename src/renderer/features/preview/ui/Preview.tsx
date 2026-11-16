import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/Project';
import { usePlayback } from '@/features/preview/model/Playback';
import { ChevronLeft, ChevronRight, Play, SkipBack, Volume2, VolumeX } from 'lucide-react';
import { timecode, IconButton } from '@/shared/ui';
import { character } from '@/fixtures/studio';
import { Tooltip } from '@/shared/ui/Tooltip';

export function Preview({ full = false }: { full?: boolean }) {
  useTranslation(undefined, { i18n });
  const { demo } = useNotice();
  const { scene, currentScene, selectedLocation, visibleScenes, totalDuration } = useProject();
  const { scrub, setScrub, muted, setMuted } = usePlayback();
  if (!visibleScenes.length) return <p>{t('Preview.noScenesYet')}</p>;
  return (
    <div className="preview-shell">
      <div className="stage-image">
        <img className="background-art" src={selectedLocation.image} alt={selectedLocation.title} />
        <div className="stage-vignette" />
        {scene !== 3 && (
          <>
            <img
              className="stage-character"
              src={character.image}
              alt={t('Preview.mechanicSelectedCharacter')}
            />
            <div className="wooden-box">
              <span />
              <span />
            </div>
          </>
        )}
        <div className="subtitle">{currentScene.line}</div>
      </div>
      <div className="player-controls">
        <IconButton title={t('Preview.goToStart')} onClick={() => setScrub(0)}>
          <SkipBack size={15} />
        </IconButton>
        <Tooltip label={t('EditorPrototype.playPrototype')}>
          <button
            className="player-play"
            aria-label={t('EditorPrototype.playPrototype')}
            onClick={() => demo(t('Preview.thePreviewIsCurrentlyStaticPlaybackAnd'))}
          >
            <Play size={16} fill="currentColor" />
          </button>
        </Tooltip>
        <IconButton
          title={t('Preview.previousFrame')}
          onClick={() => setScrub((v) => Math.max(0, v - 1 / 24))}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          title={t('Preview.nextFrame')}
          onClick={() =>
            setScrub((v) => Math.min(full ? totalDuration : currentScene.duration, v + 1 / 24))
          }
        >
          <ChevronRight size={16} />
        </IconButton>
        <span className="player-time">
          {timecode(scrub)}
          <span> / {timecode(full ? totalDuration : currentScene.duration)}</span>
        </span>
        <input
          aria-label={t('Preview.previewPrototypePosition')}
          className="scrubber"
          type="range"
          min="0"
          max={full ? totalDuration : currentScene.duration}
          step="0.04"
          value={scrub}
          onChange={(e) => setScrub(Number(e.target.value))}
        />
        <IconButton
          title={muted ? t('Preview.unmutePrototype') : t('Preview.mutePrototype')}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </IconButton>
        <span className="player-ratio">16:9</span>
      </div>
    </div>
  );
}
