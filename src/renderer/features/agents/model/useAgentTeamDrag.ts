import { useState } from 'react';
import {
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useAgentProfiles } from './AgentProfiles';

// Pointer drops must actually land inside a team. Keyboard sorting retains its geometric navigation.
const collisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args);
  const agents = hits.filter(
    (hit) =>
      args.droppableContainers.find((entry) => entry.id === hit.id)?.data.current?.type === 'agent',
  );
  return agents.length ? agents : hits;
};
export function useAgentTeamDrag() {
  const { agents, teams, moveAgent, transferAgent } = useAgentProfiles();
  const [pending, setPending] = useState<{
    agentId: string;
    sourceTeamId: string;
    targetTeamId: string;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const agentId = String(active.id);
    const sourceTeamId = teams.find((team) => team.agentIds.includes(agentId))?.id;
    const targetTeamId = over.data.current?.teamId as string | undefined;
    if (!sourceTeamId || !targetTeamId) return;
    if (sourceTeamId === targetTeamId) {
      if (over.data.current?.type === 'agent') moveAgent(agentId, String(over.id));
    } else setPending({ agentId, sourceTeamId, targetTeamId });
  };
  const agent = agents.find((agent) => agent.id === pending?.agentId);
  const source = teams.find(
    (team) => team.id === pending?.sourceTeamId && team.agentIds.includes(pending.agentId),
  );
  const target = teams.find((team) => team.id === pending?.targetTeamId);
  return {
    context: { sensors, collisionDetection, onDragEnd },
    pending: pending && agent && source && target ? { agent, source, target } : null,
    cancel: () => setPending(null),
    confirm: (copy: boolean) => {
      if (pending && agent && source && target) transferAgent(agent.id, source.id, target.id, copy);
      setPending(null);
    },
  };
}
