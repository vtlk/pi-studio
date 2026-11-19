import { DragOverlay, type Modifier } from '@dnd-kit/core';
import { createPortal } from 'react-dom';
import type { Agent } from '../../../../shared/studio';
import { AgentListLabel } from './AgentListLabel';

// A drag image follows just beside the pointer, leaving the destination line visible.
const besidePointer: Modifier = ({ transform, activeNodeRect, activatorEvent }) => {
  if (!activeNodeRect || !(activatorEvent instanceof MouseEvent)) return transform;
  return {
    ...transform,
    x: transform.x + activatorEvent.clientX - activeNodeRect.left + 12,
    y: transform.y + activatorEvent.clientY - activeNodeRect.top + 12,
  };
};
export function AgentDragOverlay({
  agent,
  position,
  selected,
}: {
  agent?: Agent;
  position: number;
  selected: boolean;
}) {
  return createPortal(
    <DragOverlay dropAnimation={null} zIndex={200} modifiers={[besidePointer]}>
      {agent && (
        <div className="agent-drag-preview agent-stages" aria-hidden="true">
          <div
            className={`section-menu-item agent-list-item${selected ? ' active' : ''}`}
            data-enabled={agent.enabled}
          >
            <AgentListLabel agent={agent} position={position} />
          </div>
        </div>
      )}
    </DragOverlay>,
    document.body,
  );
}
