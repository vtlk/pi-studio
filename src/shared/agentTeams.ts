import type { Agent } from './studio';

/** Membership and order have one owner; profiles/resources keep their existing IDs. */
export interface AgentTeam {
  id: string;
  name: string;
  agentIds: string[];
}
export interface AgentCatalog {
  agents: Agent[];
  teams: AgentTeam[];
}
export function teamAgents(catalog: AgentCatalog, teamId: string): Agent[] {
  const team = catalog.teams.find((item) => item.id === teamId);
  if (!team)
    throw new Error('Исходная команда агентов отсутствует. Выберите существующую команду.');
  const profiles = new Map(catalog.agents.map((agent) => [agent.id, agent]));
  return team.agentIds.map((id) => {
    const agent = profiles.get(id);
    if (!agent) throw new Error('Профиль агента команды отсутствует. Перечитайте настройки.');
    return agent;
  });
}
