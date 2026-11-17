import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Files, MessagesSquare, Trash2 } from 'lucide-react';
import type { AgentDataTarget } from '../../../../shared/storage';
import type { ProjectAgent } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { useStorage } from '@/shared/storage/Storage';
import { Button, IconButton } from '@/shared/ui';
import { List, ListRow } from '@/shared/ui/ListRow';
import { Modal } from '@/shared/ui/Modal';
import { useChatPanels } from '@/features/chat/ChatPanels.context';

export function DeleteAgentDataButton({ agent }: { agent: ProjectAgent }) {
  useTranslation(undefined, { i18n });
  const { selectedProject, deleteAgentData, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const chats = useChatPanels();
  const [targetProject, setTargetProject] = useState<string>();
  const shared = selectedProject?.workspaceMode === 'shared';
  const disabled =
    !isDesktop ||
    !selectedProject ||
    busy ||
    selectedProject.agents.some((item) => item.runStatus === 'running');
  const remove = (target: AgentDataTarget) => {
    if (!targetProject || disabled) return;
    const projectId = targetProject;
    setTargetProject(undefined);
    void deleteAgentData(projectId, agent.profile.id, target).then((deleted) => {
      if (deleted !== false && target !== 'files')
        chats.hideFor({ projectId, agentId: agent.profile.id });
    });
  };
  return (
    <>
      <IconButton
        className="clear-agent-outputs"
        title={t('DeleteAgentDataButton.deleteAgentFilesOrDialogues')}
        disabled={disabled}
        onClick={() => setTargetProject(selectedProject?.id)}
      >
        <Trash2 size={17} aria-hidden="true" />
      </IconButton>
      {targetProject &&
        createPortal(
          <Modal
            alert
            title={t('DeleteAgentDataButton.whatShouldBeDeletedForAgent', {
              value1: agent.profile.name,
            })}
            onClose={() => setTargetProject(undefined)}
            footer={
              <Button onClick={() => setTargetProject(undefined)}>
                {t('TeamNameDialog.cancel')}
              </Button>
            }
          >
            <p>{t('DeleteAgentDataButton.deletedDataMovesToMacosTrashDeleting')}</p>
            {shared && <p>{t('DeleteAgentDataButton.filesAreSharedByTheEntireTeam')}</p>}
            <List>
              <ListRow
                label={t('DeleteAgentDataButton.agentDialogue')}
                icon={MessagesSquare}
                disabled={disabled}
                onClick={() => remove('dialogue')}
              />
              <ListRow
                label={
                  shared ? t('DeleteAgentDataButton.teamFiles') : t('AgentOutputsView.agentFiles')
                }
                icon={Files}
                disabled={disabled}
                onClick={() => remove('files')}
              />
              <ListRow
                label={t('DeleteAgentDataButton.everything')}
                icon={Trash2}
                disabled={disabled}
                onClick={() => remove('all')}
              />
            </List>
          </Modal>,
          document.querySelector('.app-shell') ?? document.body,
        )}
    </>
  );
}
