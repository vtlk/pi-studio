import { useStorage } from '@/shared/storage/Storage';
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch, type Dialog } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';

export function AgentActionDialog({ request }: { request: NonNullable<Dialog> }) {
  const { isDesktop, saveNow } = useStorage();
  const { setDialog } = useLaunch();
  const { agents, systemAgents } = useAgentProfiles();
  const { demo } = useNotice();
  const agent =
    request.kind === 'new-asset' && isDesktop
      ? systemAgents.find(
          (item) =>
            item.systemRole === (request.assetType === 'characters' ? 'character' : 'location'),
        )
      : (request.profile ?? agents.find((item) => item.id === request.agentId));
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);
  const creating = request.kind === 'new-asset';
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!isDesktop || !window.studio || !creating) {
      demo('Pi пока не подключён в веб-прототипе; файлы не отправлялись.');
      return;
    }
    setOpening(true);
    setError('');
    try {
      if (!(await saveNow())) throw new Error('Сначала сохраните текущие настройки.');
      await window.studio.createLibraryAsset({
        kind: request.assetType === 'characters' ? 'characters' : 'locations',
        description: description.trim(),
        attachments: references.map((item) => item.id),
      });
      setDialog(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось открыть Pi.');
    } finally {
      setOpening(false);
    }
  };
  return (
    <Modal
      title={request.title}
      onClose={() => {
        if (!opening) setDialog(null);
      }}
      footer={
        <>
          <Button disabled={opening} onClick={() => setDialog(null)}>
            Отмена
          </Button>
          <Button
            kind="primary"
            disabled={opening || !agent?.enabled || (creating && !description.trim())}
            onClick={() => void submit()}
          >
            {opening ? 'Открываем Pi…' : creating ? 'Создать с Pi' : 'Открыть диалог агента'}
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
      {creating && (
        <ReferenceAttachments value={references} onChange={setReferences} disabled={opening} />
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {request.description && <p>{request.description}</p>}
      <p>
        {agent
          ? `Агент: ${agent.name}. Основной промпт и инструменты заданы в конструкторе.`
          : creating && isDesktop
            ? 'Создание материалов через Pi ещё не подключено.'
            : 'Запрошенный агент отсутствует. Выберите или создайте профиль в конструкторе.'}
      </p>
      {agent && !agent.enabled && <p>Агент выключен.</p>}
    </Modal>
  );
}
