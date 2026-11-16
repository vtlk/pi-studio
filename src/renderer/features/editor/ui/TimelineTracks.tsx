import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { DemoTimeline } from '../model/timeline';
import { durationFrames } from '../model/timeline';
export function TimelineTracks({
  timeline,
  selected,
  frame,
  onSelect,
}: {
  timeline: DemoTimeline;
  selected: string;
  frame: number;
  onSelect: (id: string) => void;
}) {
  useTranslation(undefined, { i18n });
  const total = durationFrames(timeline);
  return (
    <div className="editor-timeline" aria-label={t('TimelineTracks.prototypeTimeline')}>
      <div className="editor-ruler">
        <span>00:00</span>
        <span>
          {(total / timeline.fps).toFixed(1)} {t('NativeMontageCard.s')}
        </span>
      </div>
      {timeline.tracks.map((track) => (
        <div className="editor-track" key={track.id}>
          <div className="editor-track-name">
            <span>{track.label}</span>
          </div>
          <div className="editor-track-clips" data-muted={track.muted || undefined}>
            {track.clips.map((clip) => (
              <button
                className={`editor-clip${selected === clip.id ? ' selected' : ''}`}
                key={clip.id}
                onClick={() => onSelect(clip.id)}
                style={{
                  left: `${(clip.start / total) * 100}%`,
                  width: `${(clip.duration / total) * 100}%`,
                }}
                aria-label={t('TimelineTrack.clip', { value1: clip.label })}
              >
                <span>{clip.label}</span>
              </button>
            ))}
            <div className="editor-playhead" style={{ left: `${(frame / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
