import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch, type Dialog } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';

export function AgentActionDialog({ request }: { request: NonNullable<Dialog> }) {
  const { setDialog } = useLaunch();
  const { agents } = useAgentProfiles();
  const { demo } = useNotice();
  const agent = request.profile ?? agents.find((item) => item.id === request.agentId);
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);
  const creating = request.kind === 'new-asset';
  return (
    <Modal
      title={request.title}
      onClose={() => setDialog(null)}
      footer={
        <>
          <Button onClick={() => setDialog(null)}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!agent?.enabled || (creating && !description.trim())}
            onClick={() =>
              demo(
                `Pi пока не подключён. Описание и ${references.length ? `референсы (${references.length})` : 'ресурсы профиля'} подготовлены в прототипе; файлы агенту ещё не отправлялись.`,
              )
            }
          >
            {creating ? 'Создать с Pi' : 'Открыть диалог агента'}
          </Button>
        </>
      }
    >
      {creating && (
        <label className="field-label">
          Описание материала
          <textarea
            autoFocus
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Какой персонаж или локация нужны?"
          />
        </label>
      )}
      {creating && <ReferenceAttachments value={references} onChange={setReferences} />}
      {request.description && <p>{request.description}</p>}
      <p>
        {agent
          ? `Агент: ${agent.name}. Основной промпт и инструменты заданы в конструкторе.`
          : 'Запрошенный агент отсутствует. Выберите или создайте профиль в конструкторе.'}
      </p>
      {agent && !agent.enabled && <p>Агент выключен.</p>}
    </Modal>
  );
}
