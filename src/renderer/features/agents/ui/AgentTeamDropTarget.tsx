import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
export function AgentTeamDropTarget({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'team:' + id,
    data: { type: 'team', teamId: id },
  });
  return (
    <div
      ref={setNodeRef}
      className="agent-team"
      data-team-id={id}
      data-drop-target={isOver || undefined}
    >
      {children}
    </div>
  );
}
