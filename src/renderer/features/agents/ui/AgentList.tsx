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

export function AgentList() {
  const { agents, selectedAgent, setAgentId, addAgent, moveAgent, removeAgent, restoreAgent } =
    useAgentProfiles();
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
      <AddArea label="Добавить агента" onClick={addAgent} />
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
    </nav>
  );
}
