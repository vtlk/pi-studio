import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';
import { useStorage } from '@/shared/storage/Storage';

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
  const { isDesktop } = useStorage();
  const { addSession } = useWorkspace();
  const { demo } = useNotice();

  const start = async () => {
    setOpening(true);
    try {
      const session = await addSession(agent.profile.id, message, autoContinue);
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
    <Modal
      title={`Запустить · ${agent.profile.name || 'Без названия'}`}
      onClose={onClose}
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
