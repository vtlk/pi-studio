import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { VideoTrack } from '../../../../shared/video';
import { Tooltip } from '@/shared/ui/Tooltip';
import { timelineLanes } from '../model/timelineLanes';

export function TimelineTrack({
  track,
  total,
  frame,
  selected,
  onSelect,
}: {
  track: VideoTrack;
  total: number;
  frame: number;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  useTranslation(undefined, { i18n });
  const layout = timelineLanes(track.items);
  return (
    <div className="editor-track">
      <Tooltip label={track.name} onlyWhenTruncated overflowSelector="span">
        <div className="editor-track-name">
          <span>{track.name}</span>
        </div>
      </Tooltip>
      <div className="editor-track-clips" style={{ height: layout.count * 40 }}>
        {track.items.map((item) => (
          <Tooltip key={item.id} label={item.name} onlyWhenTruncated>
            <button
              className={`editor-clip${selected === item.id ? ' selected' : ''}`}
              aria-label={t('TimelineTrack.clip', { value1: item.name })}
              aria-pressed={selected === item.id}
              onClick={() => onSelect(item.id)}
              style={{
                left: `${(item.from / total) * 100}%`,
                width: `${(item.duration / total) * 100}%`,
                top: (layout.lanes.get(item.id) ?? 0) * 40 + 4,
              }}
            >
              <span>{item.name}</span>
            </button>
          </Tooltip>
        ))}
        <div className="editor-playhead" style={{ left: `${(frame / total) * 100}%` }} />
      </div>
    </div>
  );
}
