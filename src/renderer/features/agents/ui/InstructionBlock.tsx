import { GripVertical, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Instruction } from '@/entities/studio/types';
import { Disclosure } from '@/shared/ui/Disclosure';
import { Switch } from '@/shared/ui/SelectionControls';
import { IconButton } from '@/shared/ui';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useNotice } from '@/shared/model/Notice';
import { useConfirm } from '@/shared/model/Confirm';
import { useAgentProfiles } from '../model/AgentProfiles';

export function InstructionBlock({ item }: { item: Instruction }) {
  const { selectedAgent, updateAgent, updateInstruction } = useAgentProfiles();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  if (!selectedAgent) return null;
  return (
    <div
      ref={setNodeRef}
      className="instruction-sortable"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <Disclosure
        label={item.name || 'Без названия'}
        leading={
          <>
            <Tooltip label="Перетащить инструкцию">
              <button
                ref={setActivatorNodeRef}
                type="button"
                className="instruction-drag-handle"
                {...attributes}
                {...listeners}
                aria-label={`Перетащить инструкцию: ${item.name}`}
                aria-roledescription="перетаскиваемая инструкция"
              >
                <GripVertical size={18} />
              </button>
            </Tooltip>
            <Switch
              checked={item.enabled}
              label={`Использовать инструкцию: ${item.name}`}
              onChange={(checked) => updateInstruction(item.id, { enabled: checked })}
            />
          </>
        }
        actions={
          <span className="instruction-delete">
            <IconButton
              title={`Удалить инструкцию: ${item.name}`}
              onClick={() =>
                confirm({
                  title: `Удалить инструкцию «${item.name}»`,
                  onConfirm: () => {
                    const saved = selectedAgent.instructions;
                    updateAgent({
                      instructions: selectedAgent.instructions.filter(
                        (entry) => entry.id !== item.id,
                      ),
                    });
                    demo('Инструкция убрана из профиля.', {
                      label: 'Вернуть',
                      onClick: () => updateAgent({ instructions: saved }),
                    });
                  },
                })
              }
            >
              <Trash2 size={17} />
            </IconButton>
          </span>
        }
      >
        <input
          aria-label={`Название инструкции: ${item.name}`}
          value={item.name}
          onChange={(event) => updateInstruction(item.id, { name: event.target.value })}
          placeholder="Название инструкции"
        />
        <textarea
          aria-label={`Текст инструкции: ${item.name}`}
          value={item.content}
          onChange={(event) => updateInstruction(item.id, { content: event.target.value })}
          placeholder="Инструкция агенту…"
        />
      </Disclosure>
    </div>
  );
}
