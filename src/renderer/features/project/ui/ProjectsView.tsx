import { useState } from 'react';
import { Folder, Search, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { ListRow } from '@/shared/ui/ListRow';
import { useStorage } from '@/shared/storage/Storage';
import { ProjectNameDialog } from './ProjectNameDialog';
import type { WorkspaceProject } from '../model/workspace.types';
import { AddArea } from '@/shared/ui/AddArea';
import { useNavigation } from '@/shared/model/Navigation';
import { useLaunch } from '@/features/launch/model/Launch';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import { ProjectListRow } from './ProjectListRow';
import { useProjectFileCounts } from '../model/useProjectFileCounts';
import { useProjectActivity } from '../model/useProjectActivity';
import './projectsList.css';

export function ProjectsView() {
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<{ project: WorkspaceProject; mode: 'clone' | 'rename' } | null>(
    null,
  );
  const { navigate } = useNavigation();
  const { projects, trashProjects, busy, setProjectId, removeProject, restoreProject } =
    useWorkspace();
  const { isDesktop } = useStorage();
  const { setDialog } = useLaunch();
  const { demo } = useNotice();
  const fileCounts = useProjectFileCounts(projects);
  const activity = useProjectActivity();
  const showSearch = projects.length >= 6;
  const search = showSearch ? query.trim().toLocaleLowerCase('ru-RU') : '';
  const shown = [...projects]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((project) =>
      [project.name, project.folderName ?? project.id].some((value) =>
        value.toLocaleLowerCase('ru-RU').includes(search),
      ),
    );
  const count = projects.length;
  const noun =
    count % 100 >= 11 && count % 100 <= 14
      ? 'проектов'
      : count % 10 === 1
        ? 'проект'
        : count % 10 >= 2 && count % 10 <= 4
          ? 'проекта'
          : 'проектов';
  return (
    <div className="page-body projects-page">
      {showSearch && (
        <div className="projects-list-toolbar">
          <span className="projects-total" aria-live="polite">
            {count} {noun}
          </span>
          <label className="projects-search">
            <Search size={19} aria-hidden="true" />
            <input
              aria-label="Найти проект"
              placeholder="Найти проект"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      <AddArea
        className="project-create-area"
        label="Создать проект"
        showLabel
        disabled={busy}
        onClick={() => setDialog({ title: 'Новый проект', kind: 'new-project' })}
      />
      <table className="projects-table" aria-label="Проекты">
        <colgroup>
          <col className="project-title-column" />
          <col className="project-date-column" />
          <col className="project-number-column" />
          <col className="project-number-column" />
          <col className="project-actions-column" />
          <col className="project-arrow-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Проект</th>
            <th scope="col">Создан</th>
            <th scope="col" className="project-number">
              Агенты
            </th>
            <th scope="col" className="project-number">
              Файлы
            </th>
            <th scope="col" aria-label="Действия с проектом" />
            <th scope="col" aria-label="Открыть проект" />
          </tr>
        </thead>
        <tbody>
          {shown.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              busy={busy}
              fileCount={fileCounts[project.id]}
              runningAgents={activity.counts[project.id] ?? 0}
              activityUnavailable={activity.unavailable}
              onOpen={() => {
                setProjectId(project.id);
                navigate('project');
              }}
              onEdit={(mode) => setEdit({ project, mode })}
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
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={6} className="projects-empty">
                {projects.length ? 'Проекты не найдены.' : 'Проектов пока нет.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {trashProjects.length > 0 && (
        <div className="projects-trash">
          <DisclosureList>
            <Disclosure label={`Корзина студии · ${trashProjects.length}`} icon={Trash2}>
              <DisclosureList>
                {trashProjects.map((project) => (
                  <ListRow
                    key={project.id}
                    label={project.name}
                    icon={Folder}
                    actions={
                      <Button disabled={busy} onClick={() => void restoreProject(project)}>
                        Восстановить
                      </Button>
                    }
                  />
                ))}
              </DisclosureList>
            </Disclosure>
          </DisclosureList>
        </div>
      )}
      {edit && <ProjectNameDialog {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
