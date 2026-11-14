import { useRef, useState } from 'react';
import type { CapabilityKind } from '@/entities/studio/types';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useWorkspace } from '@/features/project/model/Workspace';
import { AddArea } from '@/shared/ui/AddArea';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useResources, type Resource } from '../model/Resources';
import { ResourceEditor } from './ResourceEditor';
import { ResourceActions } from './ResourceActions';
import { resourceStatus } from '../model/resourceStatus';
import { ManagedSkillEditor } from './ManagedSkillEditor';

export function ResourceCatalog({
  kind,
  onPick,
  attached = [],
}: {
  kind: CapabilityKind;
  onPick?: (id: string) => void;
  attached?: string[];
}) {
  const { resources, removeResource, saveResource } = useResources();
  const { agents } = useAgentProfiles();
  const { projects } = useWorkspace();
  const { demo } = useNotice();
  const [edit, setEdit] = useState<Resource | null>(null);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [query, setQuery] = useState('');
  const importing = useRef(false);
  const add = async () => {
    if (window.studio && kind === 'skills') {
      if (importing.current) return;
      importing.current = true;
      try {
        const resource = await window.studio.chooseSkill();
        if (resource) {
          saveResource(resource);
          demo('Локальный skill добавлен. Подключение к Pi-сессии ещё не выполнялось.');
        }
      } catch (error) {
        demo(error instanceof Error ? error.message : 'Не удалось импортировать skill.');
      } finally {
        importing.current = false;
      }
      return;
    }
    setEdit({
      id: crypto.randomUUID(),
      name: '',
      kind,
      source: '',
      version: '',
      description: '',
      transport: 'HTTP',
      args: '',
      credential: '',
      contents: '',
      createdAt: Date.now(),
    });
  };
  const usage = (resource: Resource) => {
    const users = agents
      .filter((agent) => agent[kind].includes(resource.id))
      .map((agent) => agent.name);
    const snapshots = projects
      .filter((project) =>
        project.agents.some((agent) => agent.profile[kind].includes(resource.id)),
      )
      .map((project) => project.name);
    return `Агенты: ${users.join(', ') || 'нет'}. Проекты: ${snapshots.join(', ') || 'нет'}. Их ссылки и результаты сохранятся, ресурс будет отмечен как недоступный. Исходные файлы не удаляются.`;
  };
  const addArea = (
    <AddArea
      label={
        kind === 'skills'
          ? 'Добавить навык'
          : kind === 'mcps'
            ? 'Добавить MCP-сервер'
            : 'Добавить пакет Pi'
      }
      onClick={window.studio && kind === 'skills' ? undefined : () => void add()}
      actions={
        window.studio && kind === 'skills'
          ? [
              { label: 'Создать', onSelect: () => setCreatingSkill(true) },
              { label: 'Импортировать', onSelect: () => void add() },
            ]
          : undefined
      }
    />
  );
  return (
    <div className="resource-catalog">
      {!onPick && addArea}
      <label className="field-label">
        Поиск в каталоге
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {resources
        .filter(
          (item) => item.kind === kind && item.name.toLowerCase().includes(query.toLowerCase()),
        )
        .map((resource) => (
          <div className="resource-row" key={resource.id} data-removable>
            <div>
              <div className="resource-heading">
                <strong>{resource.name}</strong>
                <small>{resourceStatus(resource, !!window.studio)}</small>
              </div>
              <p>{resource.description}</p>
              <ResourceActions resource={resource} />
            </div>
            <Button onClick={() => setEdit(resource)}>
              {kind === 'skills'
                ? resource.managedSkill
                  ? 'Редактировать'
                  : 'Сведения'
                : 'Настроить'}
            </Button>
            {onPick && (
              <Button
                kind="primary"
                disabled={attached.includes(resource.id)}
                onClick={() => onPick(resource.id)}
              >
                {attached.includes(resource.id) ? 'Добавлен' : 'Добавить агенту'}
              </Button>
            )}
            {!onPick && (
              <HoverDeleteButton
                label={`Удалить ресурс ${resource.name}`}
                description={usage(resource)}
                onDelete={() => {
                  removeResource(kind, resource.id);
                  demo('Ресурс убран из каталога. Исходные файлы сохранены.', {
                    label: 'Вернуть',
                    onClick: () => saveResource(resource),
                  });
                }}
              />
            )}
          </div>
        ))}
      {onPick && addArea}
      {edit && <ResourceEditor key={edit.id} resource={edit} onClose={() => setEdit(null)} />}
      {creatingSkill && <ManagedSkillEditor onClose={() => setCreatingSkill(false)} />}
    </div>
  );
}
