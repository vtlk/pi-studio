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
  const [sharedDeletion, setSharedDeletion] = useState<'files' | 'all'>();
  const shared = selectedProject?.workspaceMode === 'shared';
  const disabled =
    !isDesktop ||
    !selectedProject ||
    busy ||
    chats.processes.some((item) => item.working && item.projectId === selectedProject.id) ||
    selectedProject.agents.some((item) => item.runStatus === 'running');
  const close = () => {
    setTargetProject(undefined);
    setSharedDeletion(undefined);
  };
  const remove = (target: AgentDataTarget) => {
    if (!targetProject || disabled || targetProject !== selectedProject?.id) return;
    const projectId = targetProject;
    close();
    void deleteAgentData(projectId, agent.profile.id, target).then((deleted) => {
      if (deleted !== false && target !== 'files')
        chats.hideFor({ projectId, agentId: agent.profile.id });
    });
  };
  const choose = (target: AgentDataTarget) => {
    if (shared && target !== 'dialogue') setSharedDeletion(target);
    else remove(target);
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
          sharedDeletion ? (
            <Modal
              key="shared-confirmation"
              alert
              showCloseButton={false}
              title={t('DeleteAgentDataButton.confirmSharedTitle')}
              onClose={close}
              footer={
                <>
                  <Button onClick={close}>{t('TeamNameDialog.cancel')}</Button>
                  <Button kind="primary" disabled={disabled} onClick={() => remove(sharedDeletion)}>
                    {t('DeleteAgentDataButton.confirmSharedAction')}
                  </Button>
                </>
              }
            >
              <p>{t('DeleteAgentDataButton.confirmSharedFiles')}</p>
              {sharedDeletion === 'all' && (
                <p>
                  {t('DeleteAgentDataButton.confirmSharedDialogue', { name: agent.profile.name })}
                </p>
              )}
            </Modal>
          ) : (
            <Modal
              key="choose-data"
              alert
              title={t('DeleteAgentDataButton.whatShouldBeDeletedForAgent', {
                value1: agent.profile.name,
              })}
              onClose={close}
              footer={<Button onClick={close}>{t('TeamNameDialog.cancel')}</Button>}
            >
              <p>{t('DeleteAgentDataButton.trashBehavior')}</p>
              <List>
                <ListRow
                  label={t('DeleteAgentDataButton.agentDialogue')}
                  icon={MessagesSquare}
                  disabled={disabled}
                  onClick={() => choose('dialogue')}
                />
                <ListRow
                  label={
                    shared ? t('DeleteAgentDataButton.teamFiles') : t('AgentOutputsView.agentFiles')
                  }
                  icon={Files}
                  disabled={disabled}
                  onClick={() => choose('files')}
                />
                <ListRow
                  label={t('DeleteAgentDataButton.everything')}
                  icon={Trash2}
                  disabled={disabled}
                  onClick={() => choose('all')}
                />
              </List>
            </Modal>
          ),
          document.querySelector('.app-shell') ?? document.body,
        )}
    </>
  );
}
