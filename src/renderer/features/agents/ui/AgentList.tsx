import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { TeamIcon } from './TeamIcon';
import { Disclosure } from '@/shared/ui/Disclosure';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { IconButton } from '@/shared/ui';
import { TeamNameDialog } from './TeamNameDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AddArea } from '@/shared/ui/AddArea';
import { useAgentProfiles } from '../model/AgentProfiles';
import { AgentListItem } from './AgentListItem';
import { useNotice } from '@/shared/model/Notice';
import { Tooltip } from '@/shared/ui/Tooltip';
import { cx } from '@/shared/ui';
import { AgentListLabel } from './AgentListLabel';
import { SetupAssistantAction } from './SetupAssistantAction';

export function AgentList() {
  const {
    agents,
    teams,
    addTeam,
    renameTeam,
    removeTeam,
    restoreTeam,
    systemAgents,
    selectedAgent,
    setAgentId,
    addAgent,
    moveAgent,
    removeAgent,
    restoreAgent,
  } = useAgentProfiles();
  const { demo } = useNotice();
  const [naming, setNaming] = useState<{ id?: string; name?: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (over) moveAgent(String(active.id), String(over.id));
  };
  return (
    <nav className="section-menu" aria-label="Конструктор агентов">
      <h2 className="agent-list-group-heading column-heading">Мои команды</h2>
      {teams.map((team, teamIndex) => {
        const profiles = team.agentIds.flatMap(
          (id) => agents.find((agent) => agent.id === id) ?? [],
        );
        return (
          <div className="agent-team" key={team.id} data-team-id={team.id}>
            <Disclosure
              label={team.name}
              icon={TeamIcon}
              defaultOpen
              actions={
                <>
                  <IconButton
                    title={`Переименовать команду «${team.name}»`}
                    className="team-rename"
                    onClick={() => setNaming({ id: team.id, name: team.name })}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <HoverDeleteButton
                    label={`Удалить команду «${team.name}»`}
                    description="Команда и её агенты будут удалены из конструктора. Проекты, результаты и диалоги сохранятся."
                    onDelete={() => {
                      removeTeam(team.id);
                      demo(`Команда «${team.name}» удалена.`, {
                        label: 'Вернуть',
                        onClick: () => restoreTeam(team, profiles, teamIndex),
                      });
                    }}
                  />
                </>
              }
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={reorder}
                accessibility={{
                  screenReaderInstructions: {
                    draggable:
                      'Пробел — взять агента. Стрелки меняют порядок в команде. Пробел завершает, Escape отменяет.',
                  },
                }}
              >
                <SortableContext items={profiles} strategy={verticalListSortingStrategy}>
                  {profiles.map((agent, index) => (
                    <AgentListItem
                      key={agent.id}
                      agent={agent}
                      position={index + 1}
                      selected={selectedAgent?.id === agent.id}
                      onSelect={() => setAgentId(agent.id)}
                      onDelete={() => {
                        removeAgent(agent.id);
                        demo(`Агент «${agent.name}» удалён из конструктора.`, {
                          label: 'Вернуть',
                          onClick: () => restoreAgent(agent, index, team.id),
                        });
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <AddArea
                className="agent-team-add"
                label={`Добавить агента в «${team.name}»`}
                onClick={() => addAgent(team.id)}
              />
            </Disclosure>
          </div>
        );
      })}
      <AddArea
        label="Создать команду"
        showLabel
        className="agent-team-create"
        onClick={() => setNaming({})}
      />
      {naming && (
        <TeamNameDialog
          name={naming.name}
          onClose={() => setNaming(null)}
          onSave={(name) => {
            if (naming.id) renameTeam(naming.id, name);
            else addTeam(name);
          }}
        />
      )}
      <h2 className="agent-list-group-heading column-heading">Системные</h2>
      {systemAgents.map((agent, index) => (
        <div className="agent-list-entry" key={agent.id} data-system-role={agent.systemRole}>
          <Tooltip
            label={agent.name || 'Без названия'}
            onlyWhenTruncated
            overflowSelector=".agent-list-name"
          >
            <button
              type="button"
              className={cx(
                'section-menu-item',
                'agent-list-item',
                selectedAgent?.id === agent.id && 'active',
              )}
              data-enabled={agent.enabled}
              aria-label={`${agent.name || 'Без названия'} · ${agent.enabled ? 'Включён' : 'Выключен'}`}
              aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
              onClick={() => setAgentId(agent.id)}
            >
              <AgentListLabel agent={agent} position={index + 1} />
            </button>
          </Tooltip>
          {agent.systemRole === 'assistant' && <SetupAssistantAction enabled={agent.enabled} />}
        </div>
      ))}
    </nav>
  );
}
