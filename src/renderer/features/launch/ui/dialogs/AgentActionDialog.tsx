import { Textarea } from '@/shared/ui/Textarea';
import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch, type Dialog } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';
import { Select } from '@/shared/ui/Select';
import { hasLibraryMcp } from '../../../../../shared/builtinResources';

export function AgentActionDialog({ request }: { request: NonNullable<Dialog> }) {
  const { isDesktop, saveNow } = useStorage();
  const { setDialog } = useLaunch();
  const { agents } = useAgentProfiles();
  const [assignments, setAssignments] = useStoredState('libraryAgents', {
    characters: '',
    locations: '',
  });
  const kind = request.assetType === 'characters' ? 'characters' : 'locations';
  const selectedId = assignments[kind];
  const eligible = agents.filter((item) => hasLibraryMcp(item));
  const { demo } = useNotice();
  const agent =
    request.kind === 'new-asset'
      ? eligible.find((item) => item.id === selectedId)
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
        agentId: agent!.id,
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
          Агент
          <Select
            label="Агент библиотеки"
            value={selectedId || 'none'}
            disabled={opening}
            options={[
              { value: 'none', label: 'Выберите агента' },
              ...eligible.map((item) => ({
                value: item.id,
                label: item.name,
                disabled: !item.enabled,
              })),
              ...(selectedId && !eligible.some((item) => item.id === selectedId)
                ? [{ value: selectedId, label: 'Назначенный агент недоступен', disabled: true }]
                : []),
            ]}
            onValueChange={(id) =>
              setAssignments((current) => ({ ...current, [kind]: id === 'none' ? '' : id }))
            }
          />
        </label>
      )}
      {creating && (
        <label className="field-label">
          Описание материала
          <Textarea
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
      {!creating && (
        <p>
          {agent
            ? `Агент: ${agent.name}. Основной промпт и инструменты заданы в конструкторе.`
            : creating && isDesktop
              ? 'Создание материалов через Pi ещё не подключено.'
              : 'Запрошенный агент отсутствует. Выберите или создайте профиль в конструкторе.'}
        </p>
      )}
      {creating && !agent && (
        <p className="subtle">
          Выберите обычного агента с MCP «Pi Studio · Библиотека». Настройте его во вкладке
          «Агенты».
        </p>
      )}
      {agent && !agent.enabled && <p>Агент выключен.</p>}
    </Modal>
  );
}
