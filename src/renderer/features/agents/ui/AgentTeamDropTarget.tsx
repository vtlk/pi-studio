import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
export function AgentTeamDropTarget({
  id,
  children,
  highlighted,
}: {
  id: string;
  children: ReactNode;
  highlighted?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'team:' + id,
    data: { type: 'team', teamId: id },
  });
  return (
    <div
      ref={setNodeRef}
      className="agent-team"
      data-team-id={id}
      data-drop-target={highlighted || isOver || undefined}
    >
      {children}
    </div>
  );
}
