import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/Project';
import { usePlayback } from '@/features/preview/model/Playback';
import { ChevronLeft, ChevronRight, Play, SkipBack, Volume2, VolumeX } from 'lucide-react';
import { timecode, IconButton } from '@/shared/ui';
import { character } from '@/fixtures/studio';
import { Tooltip } from '@/shared/ui/Tooltip';

export function Preview({ full = false }: { full?: boolean }) {
  const { demo } = useNotice();
  const { scene, currentScene, selectedLocation, visibleScenes, totalDuration } = useProject();
  const { scrub, setScrub, muted, setMuted } = usePlayback();
  if (!visibleScenes.length) return <p>Сцен пока нет.</p>;
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
              alt="Механик — выбранный персонаж"
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
        <IconButton title="В начало" onClick={() => setScrub(0)}>
          <SkipBack size={15} />
        </IconButton>
        <Tooltip label="Воспроизвести макет">
          <button
            className="player-play"
            aria-label="Воспроизвести макет"
            onClick={() =>
              demo(
                'Предпросмотр сейчас статический. Воспроизведение и звук появятся с Remotion Player.',
              )
            }
          >
            <Play size={16} fill="currentColor" />
          </button>
        </Tooltip>
        <IconButton
          title="Предыдущий кадр"
          onClick={() => setScrub((v) => Math.max(0, v - 1 / 24))}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          title="Следующий кадр"
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
          aria-label="Позиция макета предпросмотра"
          className="scrubber"
          type="range"
          min="0"
          max={full ? totalDuration : currentScene.duration}
          step="0.04"
          value={scrub}
          onChange={(e) => setScrub(Number(e.target.value))}
        />
        <IconButton
          title={muted ? 'Включить звук макета' : 'Выключить звук макета'}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </IconButton>
        <span className="player-ratio">16:9</span>
      </div>
    </div>
  );
}
