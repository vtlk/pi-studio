import { uiText } from '@/shared/model/UiText';
import { agentName } from '@/shared/model/localizedProfiles';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Agent } from '@/entities/studio/types';
import { cx } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import { AgentListLabel } from './AgentListLabel';

export function AgentListItem({
  agent,
  position,
  teamId,
  selected,
  onSelect,
  onDelete,
}: {
  agent: Agent;
  position: number;
  teamId: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  useTranslation(undefined, { i18n });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
    data: { type: 'agent', teamId },
  });
  return (
    <div
      ref={setNodeRef}
      className="agent-list-entry"
      data-removable
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <Tooltip
        label={agentName(agent) || t('AgentList.untitled')}
        onlyWhenTruncated
        overflowSelector=".agent-list-name"
      >
        <button
          type="button"
          className={cx('section-menu-item', 'agent-list-item', selected && 'active')}
          {...attributes}
          {...listeners}
          aria-label={t('AgentListItem.summary', {
            value1: position,
            value2: agentName(agent) || t('AgentList.untitled'),
            value3: agent.enabled ? t('AgentList.enabled') : t('AgentList.disabled'),
          })}
          aria-current={selected ? 'true' : undefined}
          data-enabled={agent.enabled}
          onClick={onSelect}
        >
          <AgentListLabel agent={agent} position={position} />
        </button>
      </Tooltip>
      <HoverDeleteButton
        label={uiText('AgentListItem.deleteAgent', {
          value1: agentName(agent) || t('AgentList.untitled'),
        })}
        onDelete={onDelete}
      />
    </div>
  );
}
