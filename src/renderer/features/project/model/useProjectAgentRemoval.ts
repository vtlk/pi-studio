import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from './Workspace';
import type { ProjectAgent } from './workspace.types';

export function useProjectAgentRemoval(agent: ProjectAgent) {
  useTranslation(undefined, { i18n });
  const { selectedProject, removeProjectAgent, restoreProjectAgent, busy } = useWorkspace();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const projectId = selectedProject?.id;
  return {
    disabled: busy || !projectId,
    remove: () => {
      if (!projectId || busy) return;
      confirm({
        title: t('useProjectAgentRemoval.removeAgentFromTheProject', {
          value1: agent.profile.name || t('AgentList.untitled'),
        }),
        description: t('useProjectAgentRemoval.theAgentWillLeaveThisProjectS'),
        onConfirm: () => {
          void (async () => {
            if ((await removeProjectAgent(projectId, agent.profile.id)) === false) return;
            demo(t('useProjectAgentRemoval.agentRemovedFromTheProjectFilesAnd'), {
              label: t('useResourceUnlink.undo'),
              onClick: () => {
                void restoreProjectAgent(projectId, agent.profile.id);
              },
            });
          })();
        },
      });
    },
  };
}
