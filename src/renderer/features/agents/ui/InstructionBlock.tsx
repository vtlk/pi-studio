import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Instruction } from '@/entities/studio/types';
import { Disclosure } from '@/shared/ui/Disclosure';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '../model/AgentProfiles';

export function InstructionBlock({ item }: { item: Instruction }) {
  useTranslation(undefined, { i18n });
  const { selectedAgent, updateAgent, updateInstruction } = useAgentProfiles();
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
        label={item.name || t('AgentList.untitled')}
        dragHandle={
          <Tooltip label={t('InstructionBlock.dragInstruction')}>
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="instruction-drag-handle"
              {...attributes}
              {...listeners}
              aria-label={t('InstructionBlock.dragInstruction2', { value1: item.name })}
              aria-roledescription={t('InstructionBlock.draggedInstruction')}
            >
              <GripVertical size={18} />
            </button>
          </Tooltip>
        }
        toggle={{
          checked: item.enabled,
          label: t('InstructionBlock.useInstruction', { value1: item.name }),
          onChange: (checked) => updateInstruction(item.id, { enabled: checked }),
        }}
        actions={
          <HoverDeleteButton
            label={uiText('InstructionBlock.deleteInstruction', { value1: item.name })}
            onDelete={() => {
              const position = selectedAgent.instructions.findIndex(
                (entry) => entry.id === item.id,
              );
              updateAgent((current) => ({
                instructions: current.instructions.filter((entry) => entry.id !== item.id),
              }));
              demo(uiText('InstructionBlock.instructionRemovedFromTheProfile'), {
                label: uiText('useResourceUnlink.undo'),
                onClick: () =>
                  updateAgent((current) => {
                    if (current.instructions.some((entry) => entry.id === item.id)) return {};
                    const instructions = [...current.instructions];
                    instructions.splice(Math.max(0, position), 0, item);
                    return { instructions };
                  }),
              });
            }}
          />
        }
      >
        <input
          aria-label={t('InstructionBlock.instructionName', { value1: item.name })}
          value={item.name}
          onChange={(event) => updateInstruction(item.id, { name: event.target.value })}
          placeholder={t('InstructionBlock.instructionName2')}
        />
        <Textarea
          aria-label={t('InstructionBlock.instructionText', { value1: item.name })}
          value={item.content}
          onChange={(event) => updateInstruction(item.id, { content: event.target.value })}
          placeholder={t('InstructionBlock.instructionsForTheAgent')}
        />
      </Disclosure>
    </div>
  );
}
