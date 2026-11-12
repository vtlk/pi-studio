import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';

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
  const { addSession } = useWorkspace();
  const { demo } = useNotice();

  const start = () => {
    const session = addSession(agent.profile.id, message, autoContinue);
    if (!session) return;
    onClose();
    demo('Первое сообщение и привязка диалога сохранены в памяти прототипа. Pi пока не подключён.');
  };

  return (
    <Modal
      title={`Запустить · ${agent.profile.name || 'Без названия'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!agent.profile.enabled || !message.trim()}
            onClick={start}
          >
            {autoContinue ? 'Запустить и продолжить' : 'Запустить'}
          </Button>
        </>
      }
    >
      <label className="field-label">
        Первое сообщение
        <textarea
          autoFocus
          className="agent-first-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Опишите, что должен сделать агент"
          aria-describedby="agent-first-message-help"
        />
      </label>
      <p id="agent-first-message-help" className="subtle">
        Будет отправлено первым сообщением в новый диалог Pi. Используем текущие инструкции из
        конструктора и инструменты проектного агента.
      </p>
    </Modal>
  );
}
