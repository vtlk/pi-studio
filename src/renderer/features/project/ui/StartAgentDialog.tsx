import { Textarea } from '@/shared/ui/Textarea';
import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';
import { useStorage } from '@/shared/storage/Storage';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { validateAgentModel } from '../../../../shared/modelConfiguration';
import { AgentConfigurationDialog } from './AgentConfigurationDialog';

export function StartAgentDialog({
  agent,
  autoContinue,
  onClose,
}: {
  agent: ProjectAgent;
  autoContinue: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [opening, setOpening] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);
  const { isDesktop } = useStorage();
  const { addSession } = useWorkspace();
  const { demo } = useNotice();
  const { agents } = useAgentProfiles();
  const { connections } = useConnections();

  const start = async () => {
    const current = agents.find((profile) => profile.id === agent.profile.id);
    if (!validateAgentModel(current?.model, connections).ok) {
      setConfigurationOpen(true);
      return;
    }
    setOpening(true);
    try {
      const session = await addSession(
        agent.profile.id,
        message,
        autoContinue,
        references.map((item) => item.id),
      );
      if (!session) return;
      onClose();
      if (!isDesktop)
        demo(
          'Первое сообщение и привязка диалога сохранены в памяти прототипа. Pi пока не подключён.',
        );
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <Modal
        inert={configurationOpen}
        title={`Запустить · ${agent.profile.name || 'Без названия'}`}
        onClose={() => {
          if (!opening) onClose();
        }}
        footer={
          <>
            <Button disabled={opening} onClick={onClose}>
              Отмена
            </Button>
            <Button
              kind="primary"
              disabled={opening || !agent.profile.enabled || !message.trim()}
              onClick={() => void start()}
            >
              {opening ? 'Открываем Pi…' : autoContinue ? 'Запустить и продолжить' : 'Запустить'}
            </Button>
          </>
        }
      >
        <Textarea
          label="Первое сообщение"
          autoFocus
          className="agent-first-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Опишите, что должен сделать агент"
          aria-describedby="agent-first-message-help"
        />
        <ReferenceAttachments value={references} onChange={setReferences} disabled={opening} />
        <p id="agent-first-message-help" className="subtle">
          Будет отправлено первым сообщением в новый диалог Pi. Используем текущие инструкции из
          конструктора и инструменты проектного агента.
        </p>
      </Modal>
      {configurationOpen && (
        <AgentConfigurationDialog
          agentId={agent.profile.id}
          onClose={() => setConfigurationOpen(false)}
        />
      )}
    </>
  );
}
