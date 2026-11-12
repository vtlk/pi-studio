import { useNotice } from '@/shared/model/Notice';
import { useLaunch } from '@/features/launch/model/Launch';
import { useProject } from '@/features/project/model/Project';
import { Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { IconButton, Badge } from '@/shared/ui';
import { scenes } from '@/fixtures/studio';
import { Tooltip } from '@/shared/ui/Tooltip';

export function VoiceRows({ compact = false }: { compact?: boolean }) {
  const { demo } = useNotice();
  const { openRun } = useLaunch();
  const { scene, currentScene } = useProject();
  return (
    <div className="voice-list">
      {(compact ? [currentScene, ...scenes.slice(1, 2)] : scenes).map((s, i) => (
        <div className="voice-row" key={`${s.id}-${i}`}>
          <Tooltip label={`Прослушать реплику ${i + 1}`}>
            <button
              className="audio-play"
              aria-label={`Прослушать реплику ${i + 1}`}
              onClick={() =>
                demo('Здесь будет прослушивание выбранного дубля. В прототипе аудио нет.')
              }
            >
              <Play size={15} fill="currentColor" />
            </button>
          </Tooltip>
          <div>
            <span className="voice-speaker">
              {i === 2 ? 'Соседка' : 'Механик'}
              <small>Сцена {compact ? scene + 1 : i + 1}</small>
            </span>
            <p>{s.line}</p>
            <div className="inline">
              <Badge>Дубль 2</Badge>
              <span className="subtle">{[1.8, 2.3, 3.1, 2.6, 2.4][i]} с · метки слов</span>
            </div>
          </div>
          <div className="voice-actions">
            <IconButton
              title="Настроить интонацию"
              onClick={() => openRun('Изменить интонацию', s.line, 'animation')}
            >
              <SlidersHorizontal size={15} />
            </IconButton>
            <IconButton
              title="Новый дубль"
              onClick={() => openRun('Перегенерировать реплику', s.line, 'animation')}
            >
              <RotateCcw size={15} />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}
