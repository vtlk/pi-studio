import type { ComputerState } from './computer.ts';
import type { BrowserState } from './browser.ts';
import type { ResourceCheck } from './resources.ts';
import type { Agent } from './studio.ts';
import type { AgentTeam } from './agentTeams.ts';
import type { TeamImportReport } from './teamPackage.ts';

export type ConnectionReadiness = 'checking' | 'ready' | 'not_ready' | 'invalid' | 'unavailable';
export type McpReadiness = ResourceCheck['status'] | 'checking' | 'missing';
export interface OnboardingReadiness {
  folder: string;
  terminal: 'checking' | 'ready' | 'missing';
  git?: 'checking' | 'ready' | 'missing';
  connections: Record<string, ConnectionReadiness>;
  mcps: Record<string, McpReadiness>;
  computer?: ComputerState;
  browser?: BrowserState;
  images?: 'checking' | 'ready' | 'not_ready' | 'unavailable';
}
export interface ImportedMcpScope {
  resourceId: string;
  teamIds: string[];
}
/** Only current, enabled assignments from imported packets. Manual MCPs are not onboarding tasks. */
export function importedMcpScopes(
  agents: readonly Agent[],
  teams: readonly AgentTeam[],
  reports: readonly TeamImportReport[],
): ImportedMcpScope[] {
  const scopes = new Map<string, ImportedMcpScope>();
  for (const report of reports) {
    const team = teams.find((team) => team.id === report.teamId);
    if (!team) continue;
    for (const mcp of report.mcps ?? []) {
      if (
        !agents.some(
          (agent) =>
            agent.enabled &&
            team.agentIds.includes(agent.id) &&
            agent.mcps.includes(mcp.resourceId) &&
            agent.capabilitySettings?.[`mcps:${mcp.resourceId}`]?.enabled !== false,
        )
      )
        continue;
      const scope = scopes.get(mcp.resourceId) ?? { resourceId: mcp.resourceId, teamIds: [] };
      if (!scope.teamIds.includes(team.id)) scope.teamIds.push(team.id);
      scopes.set(mcp.resourceId, scope);
    }
  }
  return [...scopes.values()];
}
