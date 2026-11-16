import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  useTranslation(undefined, { i18n });
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
  const search = showSearch ? query.trim().toLocaleLowerCase(i18n.resolvedLanguage) : '';
  const shown = [...projects]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((project) =>
      [project.name, project.folderName ?? project.id].some((value) =>
        value.toLocaleLowerCase(i18n.resolvedLanguage).includes(search),
      ),
    );
  const count = projects.length;
  return (
    <div className="page-body projects-page">
      {showSearch && (
        <div className="projects-list-toolbar">
          <span className="projects-total" aria-live="polite">
            {t('projects.count', { count })}
          </span>
          <label className="projects-search">
            <Search size={19} aria-hidden="true" />
            <input
              aria-label={t('ProjectsView.searchProjects')}
              placeholder={t('ProjectsView.searchProjects')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      <AddArea
        className="project-create-area"
        label={t('NewProjectDialog.createProject')}
        showLabel
        disabled={busy}
        onClick={() => setDialog({ title: t('ProjectsView.newProject'), kind: 'new-project' })}
      />
      <table className="projects-table" aria-label={t('Topbar.projects')}>
        <colgroup>
          <col className="project-title-column" />
          <col className="project-spent-column" />
          <col className="project-date-column" />
          <col className="project-number-column" />
          <col className="project-number-column" />
          <col className="project-actions-column" />
          <col className="project-arrow-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{t('ProjectsView.project2')}</th>
            <th scope="col">{t('ProjectsView.timeSpent')}</th>
            <th scope="col">{t('ProjectsView.created')}</th>
            <th scope="col" className="project-number">
              {t('Topbar.agents')}
            </th>
            <th scope="col" className="project-number">
              {t('ProjectsView.files')}
            </th>
            <th scope="col" aria-label={t('ProjectsView.projectActions')} />
            <th scope="col" aria-label={t('ProjectsView.openProject')} />
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
                    ? t('ProjectsView.projectMovedToStudioTrashAllFiles')
                    : t('ProjectsView.projectRemovedFromThePrototypeList'),
                  {
                    label: t('useResourceUnlink.undo'),
                    onClick: () => restoreProject(project),
                  },
                );
              }}
            />
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={7} className="projects-empty">
                {projects.length
                  ? t('ProjectsView.noProjectsFound')
                  : t('ProjectsView.noProjectsYet')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {trashProjects.length > 0 && (
        <div className="projects-trash">
          <DisclosureList>
            <Disclosure
              label={t('ProjectsView.studioTrash', { value1: trashProjects.length })}
              icon={Trash2}
            >
              <DisclosureList>
                {trashProjects.map((project) => (
                  <ListRow
                    key={project.id}
                    label={project.name}
                    icon={Folder}
                    actions={
                      <Button disabled={busy} onClick={() => void restoreProject(project)}>
                        {t('ProjectsView.restore')}
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
