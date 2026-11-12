import { Play } from 'lucide-react';
import { useLaunch } from '@/features/launch/model/Launch';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '../model/Project';
import { Button, IconButton } from '@/shared/ui';
const sounds = [
  { name: 'Двор: город и ветер', start: '00:00', duration: '12 с', volume: 35 },
  { name: 'Шаги по асфальту', start: '00:00', duration: '4 с', volume: 55 },
  { name: 'Стук из ящика', start: '00:08', duration: '1 с', volume: 65 },
  { name: 'Проезжающая машина', start: '00:03', duration: '4 с', volume: 20 },
];
export function SoundLayers() {
  const { openRun } = useLaunch();
  const { demo } = useNotice();
  const { invalidate } = useProject();
  return (
    <>
      <div className="stage-actions">
        <Button
          kind="primary"
          onClick={() =>
            openRun(
              'Обогатить звуком',
              'Подготовь подробное звуковое окружение выбранной сцены.',
              'animation',
            )
          }
        >
          Обогатить звуком
        </Button>
      </div>
      <table className="sound-table">
        <thead>
          <tr>
            <th>Звук</th>
            <th>Начало</th>
            <th>Длительность</th>
            <th>Громкость</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sounds.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td>{item.start}</td>
              <td>{item.duration}</td>
              <td>
                <input
                  type="range"
                  aria-label={`Громкость: ${item.name}`}
                  defaultValue={item.volume}
                  onChange={invalidate}
                />
              </td>
              <td>
                <IconButton
                  title={`Прослушать: ${item.name}`}
                  onClick={() => demo('Аудио пока не подключено.')}
                >
                  <Play size={15} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
