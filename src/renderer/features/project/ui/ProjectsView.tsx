import { useState } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { Button, IconButton } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import { useStorage } from '@/shared/storage/Storage';
import { ProjectNameDialog } from './ProjectNameDialog';
import type { WorkspaceProject } from '../model/workspace.types';
import { AddArea } from '@/shared/ui/AddArea';
import { useNavigation } from '@/shared/model/Navigation';
import { useLaunch } from '@/features/launch/model/Launch';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import { countFiles } from '../model/outputTree';

export function ProjectsView() {
  const [edit, setEdit] = useState<{ project: WorkspaceProject; mode: 'clone' | 'rename' } | null>(
    null,
  );
  const { navigate } = useNavigation();
  const { projects, trashProjects, busy, setProjectId, removeProject, restoreProject } =
    useWorkspace();
  const { isDesktop } = useStorage();
  const { setDialog } = useLaunch();
  const { demo } = useNotice();
  return (
    <div className="page-body">
      <AddArea
        className="project-create-area"
        label="Создать проект"
        onClick={() => setDialog({ title: 'Новый проект', kind: 'new-project' })}
      />
      {!projects.length && <p className="no-results">Проектов пока нет.</p>}
      <div className="project-list">
        {projects.map((project) => (
          <div className="project-list-item" key={project.id} data-removable>
            <button
              className="project-list-row"
              onClick={() => {
                setProjectId(project.id);
                navigate('project');
              }}
            >
              <strong>{project.name}</strong>
              <span>Агентов: {project.agents.length}</span>
              <span>
                Файлов:{' '}
                {project.agents.reduce((count, agent) => count + countFiles(agent.entries), 0)}
              </span>
            </button>
            <div className="project-row-actions">
              <IconButton
                title={`Переименовать ${project.name}`}
                onClick={() => setEdit({ project, mode: 'rename' })}
              >
                <Pencil size={16} />
              </IconButton>
              <IconButton
                title={`Клонировать ${project.name}`}
                onClick={() => setEdit({ project, mode: 'clone' })}
              >
                <Copy size={16} />
              </IconButton>
            </div>
            <HoverDeleteButton
              label={`Удалить проект «${project.name}»`}
              onDelete={async () => {
                if ((await removeProject(project.id)) === false) return;
                demo(
                  isDesktop
                    ? 'Проект перемещён в корзину студии. Все файлы сохранены.'
                    : 'Проект удалён из списка прототипа.',
                  {
                    label: 'Вернуть',
                    onClick: () => restoreProject(project),
                  },
                );
              }}
            />
          </div>
        ))}
      </div>
      {trashProjects.length > 0 && (
        <Disclosure label={`Корзина студии · ${trashProjects.length}`}>
          {trashProjects.map((project) => (
            <div className="version-row" key={project.id}>
              <span>{project.name}</span>
              <Button disabled={busy} onClick={() => void restoreProject(project)}>
                Восстановить
              </Button>
            </div>
          ))}
        </Disclosure>
      )}
      {edit && <ProjectNameDialog {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
