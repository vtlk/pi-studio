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

export function AgentList() {
  const {
    agents,
    systemAgents,
    selectedAgent,
    setAgentId,
    addAgent,
    moveAgent,
    removeAgent,
    restoreAgent,
  } = useAgentProfiles();
  const { demo } = useNotice();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (over) moveAgent(String(active.id), String(over.id));
  };
  return (
    <nav className="section-menu" aria-label="Конструктор агентов">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorder}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Нажмите пробел, чтобы взять агента. Стрелки вверх и вниз меняют порядок. Пробел завершает перенос, Escape отменяет.',
          },
        }}
      >
        <SortableContext items={agents} strategy={verticalListSortingStrategy}>
          {agents.map((agent, index) => (
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
                  onClick: () => restoreAgent(agent, index),
                });
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddArea label="Добавить агента" onClick={addAgent} />
      <h2 className="system-agents-heading">Системные</h2>
      {systemAgents.map((agent) => (
        <div className="agent-list-entry" key={agent.id} data-system-role={agent.systemRole}>
          <Tooltip label={agent.name || 'Без названия'}>
            <button
              type="button"
              className={cx(
                'section-menu-item',
                'agent-list-item',
                selectedAgent?.id === agent.id && 'active',
              )}
              data-enabled={agent.enabled}
              aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
              onClick={() => setAgentId(agent.id)}
            >
              <span>{agent.name || 'Без названия'}</span>
            </button>
          </Tooltip>
        </div>
      ))}
    </nav>
  );
}
