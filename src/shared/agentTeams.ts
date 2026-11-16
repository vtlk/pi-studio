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
