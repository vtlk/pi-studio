import { ChevronLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import type { WorkspaceProject } from '../model/workspace.types';
import { useNavigation } from '@/shared/model/Navigation';
import { Tooltip } from '@/shared/ui/Tooltip';
import { Button } from '@/shared/ui';
import { TeamMessages } from './TeamMessages';

export function ProjectHeader({
  project,
  onRefresh,
}: {
  project: WorkspaceProject;
  onRefresh: () => void;
}) {
  useTranslation(undefined, { i18n });
  const { navigate } = useNavigation();
  const back = () => navigate('projects');
  return (
    <div className="project-header" onClick={back}>
      <h1>
        <Tooltip label={project.name} onlyWhenTruncated overflowSelector="span">
          <button
            type="button"
            className="project-back"
            onClick={(event) => {
              event.stopPropagation();
              back();
            }}
            aria-label={t('ProjectView.backToProjects')}
          >
            <ChevronLeft size={26} aria-hidden="true" />
            <span>{project.name}</span>
          </button>
        </Tooltip>
      </h1>
      <div className="project-header-actions" onClick={(event) => event.stopPropagation()}>
        {window.studio && <TeamMessages project={project} />}
        <Button kind="primary" onClick={onRefresh}>
          <RefreshCw size={17} />
          {t('ProjectView.refreshAgents2')}
        </Button>
      </div>
    </div>
  );
}
