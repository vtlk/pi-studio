import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
export function ExportDialog({ accepted, onClose }: { accepted: boolean; onClose: () => void }) {
  const { demo } = useNotice();
  const [checked, setChecked] = useState(false);
  const [folder, setFolder] = useState('exports/');
  return (
    <Modal
      title="Финальный рендер"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Закрыть</Button>
          <Button
            kind="primary"
            disabled={!accepted || !checked || !folder.trim()}
            onClick={() =>
              demo(
                'Рендер не запускался. Экспорт MP4 появится после утверждения интерфейса и подключения рендера.',
              )
            }
          >
            Запустить рендер
          </Button>
        </>
      }
    >
      <p>
        {accepted
          ? 'Текущая общая версия принята в макете.'
          : 'Сначала примите текущую общую сборку. Принятие отдельных сцен не разрешает экспорт.'}
      </p>
      <div className="field-grid">
        <label className="field-label">
          Размер
          <Select label="Размер экспорта" options={['1080 × 1920']} />
        </label>
        <label className="field-label">
          FPS
          <Select label="FPS экспорта" options={['30']} />
        </label>
      </div>
      <label className="field-label">
        Формат
        <Select label="Формат экспорта" options={['MP4 · H.264']} />
      </label>
      <label className="field-label">
        Папка результата
        <input value={folder} onChange={(event) => setFolder(event.target.value)} />
      </label>
      <Button onClick={() => setChecked(true)}>Проверить пример материалов</Button>
      {checked && (
        <p className="prototype-note">
          Проверен только демонстрационный документ. Проверка реальных файлов ещё не подключена.
        </p>
      )}
      <dl className="data-list">
        <dt>Прогресс</dt>
        <dd>Не начат</dd>
        <dt>Результат</dt>
        <dd>{folder}film.mp4 · файл не создан</dd>
        <dt>Проверка MP4</dt>
        <dd>После рендера: длительность, размер, FPS, звук</dd>
      </dl>
    </Modal>
  );
}
