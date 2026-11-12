import { useState } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { IconButton } from '@/shared/ui';
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
  const { projects, setProjectId, removeProject, restoreProject } = useWorkspace();
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
              onDelete={() => {
                removeProject(project.id);
                demo('Проект удалён из списка прототипа.', {
                  label: 'Вернуть',
                  onClick: () => restoreProject(project),
                });
              }}
            />
          </div>
        ))}
      </div>
      {edit && <ProjectNameDialog {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
