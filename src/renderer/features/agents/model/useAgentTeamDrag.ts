import { useRef, useState } from 'react';
import {
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useAgentProfiles } from './AgentProfiles';

interface Destination {
  agentId: string;
  sourceTeamId: string;
  targetTeamId: string;
  beforeId?: string;
}
export function useAgentTeamDrag() {
  const { agents, teams, moveAgent, transferAgent } = useAgentProfiles();
  const [activeId, setActiveId] = useState<string>();
  const [insertion, setInsertion] = useState<Destination | null>(null);
  const [pending, setPending] = useState<Destination | null>(null);
  const pointerY = useRef<number | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const collisionDetection: CollisionDetection = (args) => {
    pointerY.current = args.pointerCoordinates?.y;
    if (!args.pointerCoordinates) return closestCenter(args);
    const hits = pointerWithin(args);
    const rows = hits.filter(
      (hit) =>
        args.droppableContainers.find((entry) => entry.id === hit.id)?.data.current?.type ===
        'agent',
    );
    return rows.length ? rows : hits;
  };
  const destination = ({ active, over }: DragMoveEvent): Destination | null => {
    if (!over) return null;
    const agentId = String(active.id);
    const source = teams.find((team) => team.agentIds.includes(agentId));
    const target = teams.find((team) => team.id === over.data.current?.teamId);
    if (!source || !target || source === target) return null;
    let beforeId: string | undefined;
    if (over.data.current?.type === 'agent') {
      const index = target.agentIds.indexOf(String(over.id));
      const rect = active.rect.current.translated;
      const y = pointerY.current ?? (rect ? rect.top + rect.height / 2 : over.rect.top);
      beforeId = target.agentIds[index + (y >= over.rect.top + over.rect.height / 2 ? 1 : 0)];
    }
    return { agentId, sourceTeamId: source.id, targetTeamId: target.id, beforeId };
  };
  const preview = (event: DragMoveEvent) => {
    const next = destination(event);
    setInsertion((previous) =>
      previous?.agentId === next?.agentId &&
      previous?.targetTeamId === next?.targetTeamId &&
      previous?.beforeId === next?.beforeId
        ? previous
        : next,
    );
  };
  const reset = () => {
    setActiveId(undefined);
    setInsertion(null);
    pointerY.current = undefined;
  };
  const onDragEnd = (event: DragEndEvent) => {
    const drop = destination(event);
    reset();
    if (drop) setPending(drop);
    else if (event.over?.data.current?.type === 'agent') {
      moveAgent(String(event.active.id), String(event.over.id));
    }
  };
  const agent = agents.find((agent) => agent.id === pending?.agentId);
  const source = teams.find(
    (team) => team.id === pending?.sourceTeamId && team.agentIds.includes(pending.agentId),
  );
  const target = teams.find(
    (team) =>
      team.id === pending?.targetTeamId &&
      (!pending.beforeId || team.agentIds.includes(pending.beforeId)),
  );
  const activeAgent = agents.find((agent) => agent.id === activeId);
  const activeTeam = teams.find((team) => team.agentIds.includes(activeId ?? ''));
  return {
    context: {
      sensors,
      collisionDetection,
      onDragEnd,
      onDragCancel: reset,
      onDragStart: ({ active }: DragStartEvent) => setActiveId(String(active.id)),
      onDragMove: preview,
      onDragOver: preview,
    },
    activeAgent,
    activePosition: activeTeam ? activeTeam.agentIds.indexOf(activeId!) + 1 : 0,
    insertion,
    pending: pending && agent && source && target ? { agent, source, target } : null,
    cancel: () => setPending(null),
    confirm: (copy: boolean) => {
      if (pending && agent && source && target)
        transferAgent(agent.id, source.id, target.id, copy, pending.beforeId);
      setPending(null);
    },
  };
}
