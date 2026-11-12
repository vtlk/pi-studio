import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { Preview } from '@/features/preview/ui/Preview';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '../../model/Project';
export function ExportStage() {
  const { demo } = useNotice();
  const { filmApproved, setFilmApproved, visibleScenes } = useProject();
  return (
    <div className="stage-page">
      <div className="export-layout">
        <Preview full />
        <div className="export-settings">
          <div className="acceptance-control">
            <Button
              kind={filmApproved ? 'secondary' : 'primary'}
              disabled={!visibleScenes.length}
              onClick={() => setFilmApproved(!filmApproved)}
            >
              {filmApproved ? 'Отменить принятие' : 'Принять результат'}
            </Button>
            <span>
              {filmApproved ? 'Текущая версия принята' : 'Просмотрите сборку перед рендером'}
            </span>
          </div>
          <label className="field-label">
            Разрешение
            <Select label="Разрешение" options={['1080 × 1920', '1920 × 1080', '3840 × 2160']} />
          </label>
          <label className="field-label">
            Частота кадров
            <Select label="Частота кадров" options={['30 fps', '24 fps', '25 fps']} />
          </label>
          <label className="field-label">
            Папка
            <button className="folder-field" onClick={() => demo('Выбор папки пока не подключён.')}>
              Выбрать…
            </button>
          </label>
          <Button
            kind="primary"
            disabled={!filmApproved || !visibleScenes.length}
            onClick={() => demo('Рендер пока не подключён.')}
          >
            Рендер MP4
          </Button>
        </div>
      </div>
    </div>
  );
}
