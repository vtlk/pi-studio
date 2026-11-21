import { t } from '../../shared/i18n/index.ts';
import { parseTeamWorkspaceMode, teamAgents, transferTeamAgent } from '../../shared/agentTeams.ts';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../../shared/studio.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';

export async function configureTeam(store: StudioStore, args: Record<string, unknown>) {
  const catalog = store.agentCatalog();
  if (typeof args.name !== 'string' || !args.name.trim())
    throw new Error(t('error.teamAdministration.nameTheTeam'));
  const old =
    typeof args.id === 'string' ? catalog.teams.find((team) => team.id === args.id) : undefined;
  if (args.id && !old) throw new Error(t('TeamTransfers.theTeamIsUnavailable'));
  const team = {
    id: old?.id ?? randomUUID(),
    name: args.name.trim(),
    agentIds: old?.agentIds ?? [],
    workspaceMode:
      args.workspaceMode === undefined
        ? (old?.workspaceMode ?? 'per-agent')
        : parseTeamWorkspaceMode(args.workspaceMode),
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
    throw new Error(t('error.teamAdministration.specifyAnExistingTeamTeamid'));
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

export async function reorderTeamAgents(store: StudioStore, args: Record<string, unknown>) {
  const catalog = store.agentCatalog();
  const team = catalog.teams.find(({ id }) => id === stableId(args.team_id));
  if (!team) throw Error(t('TeamTransfers.theTeamIsUnavailable'));
  if (
    !Array.isArray(args.agent_ids) ||
    args.agent_ids.length !== team.agentIds.length ||
    new Set(args.agent_ids).size !== team.agentIds.length ||
    args.agent_ids.some((id) => !team.agentIds.includes(id))
  )
    throw Error(t('CatalogRead.exactTeamOrderRequired'));
  const ordered = args.agent_ids as string[];
  const next = {
    ...catalog,
    teams: catalog.teams.map((item) => (item === team ? { ...item, agentIds: ordered } : item)),
  };
  await store.saveSection('agentCatalog', {
    ...next,
    agents: next.teams.flatMap(({ id }) => teamAgents(next, id)),
  });
  return { teamId: team.id, agentIds: ordered, updatedProjectSnapshots: false };
}

export async function transferAgentProfile(store: StudioStore, args: Record<string, unknown>) {
  const catalog = store.agentCatalog();
  const agentId = stableId(args.agent_id);
  const sourceId = stableId(args.source_team_id);
  const targetId = stableId(args.target_team_id);
  const anchor = args.before_agent_id === undefined ? undefined : stableId(args.before_agent_id);
  if (args.mode !== 'copy' && args.mode !== 'move') throw Error(t('CatalogRead.invalidTransfer'));
  const copyId = args.mode === 'copy' ? randomUUID() : undefined;
  const next = transferTeamAgent(catalog, agentId, sourceId, targetId, copyId, anchor);
  if (next === catalog) throw Error(t('CatalogRead.invalidTransfer'));
  await store.saveSection('agentCatalog', next);
  return {
    agentId: copyId ?? agentId,
    sourceAgentId: agentId,
    teamId: targetId,
    mode: args.mode,
    updatedProjectSnapshots: false,
  };
}
