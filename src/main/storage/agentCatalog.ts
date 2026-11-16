import { t } from '../../shared/i18n/index.ts';
import { randomUUID } from 'node:crypto';
import type { AgentTeam } from '../../shared/agentTeams.ts';
import type { Agent } from '../../shared/studio.ts';

/** Compatibility for old callers editing profiles; never guesses between multiple teams. */
export function reconcileTeams(agents: Agent[], previous: AgentTeam[]): AgentTeam[] {
  const ids = new Set(agents.map((agent) => agent.id));
  const teams = previous.map((team) => ({
    ...team,
    agentIds: team.agentIds.filter((id) => ids.has(id)),
  }));
  const assigned = new Set(teams.flatMap((team) => team.agentIds));
  const added = agents.filter((agent) => !assigned.has(agent.id));
  if (added.length) {
    if (!teams.length) teams.push({ id: randomUUID(), name: 'Моя команда', agentIds: [] });
    if (teams.length !== 1) throw new Error(t('error.agentCatalog.specifyATeamForThe'));
    teams[0].agentIds.push(...added.map((agent) => agent.id));
  }
  // A legacy flat reorder changes only the order within each existing team.
  return teams.map((team) => ({
    ...team,
    agentIds: agents.filter((agent) => team.agentIds.includes(agent.id)).map((agent) => agent.id),
  }));
}
