import { useState } from 'react';
import type { WorkspaceProject } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';

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
  const { cloneProject, renameProject, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const { demo } = useNotice();
  return (
    <Modal
      title={mode === 'clone' ? 'Клонировать проект' : 'Переименовать проект'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            kind="primary"
            disabled={busy || !name.trim() || /[/\\]/.test(name)}
            onClick={async () => {
              const result =
                mode === 'clone'
                  ? await cloneProject(project, name)
                  : await renameProject(project.id, name);
              if (result === false) return;
              demo(
                isDesktop
                  ? mode === 'clone'
                    ? 'Проект и все его файлы скопированы в отдельную папку.'
                    : 'Название проекта и его папка изменены.'
                  : mode === 'clone'
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
      {isDesktop && mode === 'rename' && (
        <p className="subtle">
          Открытые диалоги Pi этого проекта закроются. История сохранится; продолжение откроет её в
          новой папке.
        </p>
      )}
      {!isDesktop && <p className="subtle">Операция показана на данных веб-макета.</p>}
    </Modal>
  );
}
