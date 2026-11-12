import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Agent } from '@/entities/studio/types';
import { cx } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Tooltip } from '@/shared/ui/Tooltip';

export function AgentListItem({
  agent,
  position,
  selected,
  onSelect,
  onDelete,
}: {
  agent: Agent;
  position: number;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
  });
  return (
    <div
      ref={setNodeRef}
      className="agent-list-entry"
      data-removable
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <Tooltip label={agent.name || 'Без названия'}>
        <button
          type="button"
          className={cx('section-menu-item', 'agent-list-item', selected && 'active')}
          {...attributes}
          {...listeners}
          aria-current={selected ? 'true' : undefined}
          data-enabled={agent.enabled}
          onClick={onSelect}
        >
          <span>
            {position}. {agent.name || 'Без названия'}
          </span>
        </button>
      </Tooltip>
      <HoverDeleteButton
        label={`Удалить агента «${agent.name || 'Без названия'}»`}
        onDelete={onDelete}
      />
    </div>
  );
}
