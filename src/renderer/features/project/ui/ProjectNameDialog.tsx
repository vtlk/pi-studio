import { useState } from 'react';
import type { WorkspaceProject } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';

export function ProjectNameDialog({
  project,
  mode,
  onClose,
}: {
  project: WorkspaceProject;
  mode: 'clone' | 'rename';
  onClose: () => void;
}) {
  const [name, setName] = useState(mode === 'clone' ? `${project.name} — копия` : project.name);
  const { cloneProject, renameProject } = useWorkspace();
  const { demo } = useNotice();
  return (
    <Modal
      title={mode === 'clone' ? 'Клонировать проект' : 'Переименовать проект'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!name.trim() || /[/\\]/.test(name)}
            onClick={() => {
              if (mode === 'clone') cloneProject(project, name);
              else renameProject(project.id, name);
              demo(
                mode === 'clone'
                  ? 'Создана независимая копия снимка и примеров файлов в памяти. Папка на диске не копировалась.'
                  : 'Название и пример пути изменены в памяти. Физическая папка не переименовывалась.',
              );
              onClose();
            }}
          >
            {mode === 'clone' ? 'Клонировать' : 'Переименовать'}
          </Button>
        </>
      }
    >
      <label className="field-label">
        Название проекта
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <p>
        {mode === 'clone'
          ? 'Копия получает новый ID и собственные снимок агентов и файлы. Текущие глобальные агенты не подмешиваются.'
          : 'ID проекта, ID агентов и относительные пути результатов сохраняются.'}
      </p>
      <p className="subtle">
        Операция показана на данных прототипа. Файловое хранилище не подключено.
      </p>
    </Modal>
  );
}
