import { randomUUID } from 'node:crypto';
import type { Agent } from '../../shared/studio.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';

export async function configureTeam(store: StudioStore, args: Record<string, unknown>) {
  const catalog = store.agentCatalog();
  if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('Назовите команду.');
  const old =
    typeof args.id === 'string' ? catalog.teams.find((team) => team.id === args.id) : undefined;
  if (args.id && !old) throw new Error('Команда отсутствует.');
  const team = {
    id: old?.id ?? randomUUID(),
    name: args.name.trim(),
    agentIds: old?.agentIds ?? [],
  };
  await store.saveSection('agentCatalog', {
    ...catalog,
    teams: old
      ? catalog.teams.map((item) => (item.id === old.id ? team : item))
      : [...catalog.teams, team],
  });
  return { teamId: team.id, name: team.name, updatedProjectSnapshots: false };
}

export async function saveTeamAgent(store: StudioStore, agent: Agent, requestedTeamId?: string) {
  const catalog = store.agentCatalog();
  const previousTeam = catalog.teams.find((team) => team.agentIds.includes(agent.id));
  const teamId = requestedTeamId === undefined ? previousTeam?.id : stableId(requestedTeamId);
  if (!teamId || !catalog.teams.some((team) => team.id === teamId))
    throw new Error('Укажите существующую команду (teamId) для агента.');
  const old = catalog.agents.some((item) => item.id === agent.id);
  await store.saveSection('agentCatalog', {
    agents: old
      ? catalog.agents.map((item) => (item.id === agent.id ? agent : item))
      : [...catalog.agents, agent],
    teams: catalog.teams.map((team) => ({
      ...team,
      agentIds:
        team.id === teamId
          ? team.agentIds.includes(agent.id)
            ? team.agentIds
            : [...team.agentIds, agent.id]
          : team.agentIds.filter((id) => id !== agent.id),
    })),
  });
}
