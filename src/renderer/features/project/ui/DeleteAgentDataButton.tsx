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

export function DeleteAgentDataButton({ agent }: { agent: ProjectAgent }) {
  const { selectedProject, deleteAgentData, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const [targetProject, setTargetProject] = useState<string>();
  const disabled =
    !isDesktop ||
    !selectedProject ||
    busy ||
    selectedProject.agents.some((item) => item.runStatus === 'running');
  const remove = (target: AgentDataTarget) => {
    if (!targetProject || disabled) return;
    const projectId = targetProject;
    setTargetProject(undefined);
    void deleteAgentData(projectId, agent.profile.id, target);
  };
  return (
    <>
      <IconButton
        className="clear-agent-outputs"
        title="Удаление файлов или диалогов с агентом"
        disabled={disabled}
        onClick={() => setTargetProject(selectedProject?.id)}
      >
        <Trash2 size={17} aria-hidden="true" />
      </IconButton>
      {targetProject &&
        createPortal(
          <Modal
            alert
            title={`Что удалить у агента «${agent.profile.name}»?`}
            onClose={() => setTargetProject(undefined)}
            footer={<Button onClick={() => setTargetProject(undefined)}>Отмена</Button>}
          >
            <p>
              Удалённые данные переместятся в Корзину macOS. При удалении диалога открытый Pi этого
              агента закроется; следующий запуск начнёт новый диалог.
            </p>
            <List>
              <ListRow
                label="Диалог с агентом"
                icon={MessagesSquare}
                disabled={disabled}
                onClick={() => remove('dialogue')}
              />
              <ListRow
                label="Файлы агента"
                icon={Files}
                disabled={disabled}
                onClick={() => remove('files')}
              />
              <ListRow
                label="Всё"
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
