import { t } from './i18n/index.ts';
import type { Agent } from './studio';

export type TeamWorkspaceMode = 'per-agent' | 'shared';

/** Missing values are the legacy per-agent mode; unknown values are never silently accepted. */
export function parseTeamWorkspaceMode(value: unknown): TeamWorkspaceMode {
  if (value === undefined) return 'per-agent';
  if (value !== 'per-agent' && value !== 'shared')
    throw new Error(t('error.agentTeams.invalidTeamWorkingFolderMode'));
  return value;
}

/** Membership and order have one owner; profiles/resources keep their existing IDs. */
export interface AgentTeam {
  id: string;
  name: string;
  agentIds: string[];
  workspaceMode?: TeamWorkspaceMode;
}
export interface AgentCatalog {
  agents: Agent[];
  teams: AgentTeam[];
}
export function teamAgents(catalog: AgentCatalog, teamId: string): Agent[] {
  const team = catalog.teams.find((item) => item.id === teamId);
  if (!team) throw new Error(t('error.agentTeams.theSourceAgentTeamIs'));
  const profiles = new Map(catalog.agents.map((agent) => [agent.id, agent]));
  return team.agentIds.map((id) => {
    const agent = profiles.get(id);
    if (!agent) throw new Error(t('error.agentTeams.anAgentProfileInThe'));
    return agent;
  });
}

/** Catalog-only transfer: projects, sessions and shared resource definitions are never copied or moved. */
export function transferTeamAgent(
  catalog: AgentCatalog,
  agentId: string,
  sourceTeamId: string,
  targetTeamId: string,
  copyId?: string,
  beforeId?: string,
): AgentCatalog {
  const source = catalog.teams.find((team) => team.id === sourceTeamId);
  const target = catalog.teams.find((team) => team.id === targetTeamId);
  const agent = catalog.agents.find((item) => item.id === agentId);
  if (
    !source ||
    !target ||
    !agent ||
    (source === target && !copyId) ||
    !source.agentIds.includes(agentId)
  )
    return catalog;
  if (beforeId && !target.agentIds.includes(beforeId)) return catalog;
  const id = copyId ?? agentId;
  if (target.agentIds.includes(id) || (copyId && catalog.agents.some((item) => item.id === id)))
    return catalog;
  const profiles = copyId ? [...catalog.agents, { ...structuredClone(agent), id }] : catalog.agents;
  const targetIds = [...target.agentIds];
  targetIds.splice(beforeId ? targetIds.indexOf(beforeId) : targetIds.length, 0, id);
  const next = {
    agents: profiles,
    teams: catalog.teams.map((team) => ({
      ...team,
      agentIds:
        team.id === targetTeamId
          ? targetIds
          : team.id === sourceTeamId && !copyId
            ? team.agentIds.filter((item) => item !== id)
            : team.agentIds,
    })),
  };
  return { ...next, agents: next.teams.flatMap((team) => teamAgents(next, team.id)) };
}
