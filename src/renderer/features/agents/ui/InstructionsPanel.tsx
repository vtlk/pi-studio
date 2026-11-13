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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AddArea } from '@/shared/ui/AddArea';
import { DisclosureList } from '@/shared/ui/Disclosure';
import { useAgentProfiles } from '../model/AgentProfiles';
import { InstructionBlock } from './InstructionBlock';

export function InstructionsPanel() {
  const { selectedAgent, updateAgent } = useAgentProfiles();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!selectedAgent) return;
    if (!over || active.id === over.id) return;
    const list = selectedAgent.instructions;
    const from = list.findIndex((item) => item.id === active.id);
    const to = list.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    updateAgent({ instructions: arrayMove(list, from, to) });
  };
  if (!selectedAgent) return null;
  return (
    <div className="instruction-blocks">
      <DndContext
        key={selectedAgent.id}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorder}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Нажмите пробел, чтобы взять инструкцию. Стрелки вверх и вниз меняют порядок. Пробел завершает перенос, Escape отменяет.',
          },
        }}
      >
        <SortableContext items={selectedAgent.instructions} strategy={verticalListSortingStrategy}>
          <DisclosureList className="instruction-sortable-list">
            {selectedAgent.instructions.map((item) => (
              <InstructionBlock key={`${selectedAgent.id}:${item.id}`} item={item} />
            ))}
          </DisclosureList>
          <AddArea
            label="Добавить инструкцию"
            onClick={() =>
              updateAgent({
                instructions: [
                  {
                    id: crypto.randomUUID(),
                    name: 'Новая инструкция',
                    content: '',
                    enabled: true,
                  },
                  ...selectedAgent.instructions,
                ],
              })
            }
          />
        </SortableContext>
      </DndContext>
    </div>
  );
}
