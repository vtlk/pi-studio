import type { WorkspaceProject, ProjectAgent } from './project.ts';

export function synchronizeProjectAgentList(
  project: WorkspaceProject,
  agents: ProjectAgent[],
): WorkspaceProject {
  const ids = new Set(agents.map((agent) => agent.profile.id));
  const removed = project.agents.flatMap((agent, position) =>
    ids.has(agent.profile.id)
      ? []
      : [
          {
            agent: structuredClone({
              ...agent,
              ...(agent.runStatus === 'running' ? { runStatus: 'stopped' as const } : {}),
            }),
            position,
          },
        ],
  );
  const removedIds = new Set(removed.map((item) => item.agent.profile.id));
  return {
    ...project,
    agents,
    archivedAgents: [
      ...(project.archivedAgents ?? []).filter(
        (item) => !ids.has(item.agent.profile.id) && !removedIds.has(item.agent.profile.id),
      ),
      ...removed,
    ],
  };
}

export function archiveProjectAgent(project: WorkspaceProject, agentId: string): WorkspaceProject {
  const position = project.agents.findIndex((agent) => agent.profile.id === agentId);
  if (position < 0) throw new Error('Агент отсутствует в проекте.');
  const agent = structuredClone(project.agents[position]);
  if (agent.runStatus === 'running') agent.runStatus = 'stopped';
  return {
    ...project,
    agents: project.agents.filter((item) => item.profile.id !== agentId),
    archivedAgents: [...(project.archivedAgents ?? []), { agent, position }],
  };
}
export function restoreProjectAgent(project: WorkspaceProject, agentId: string): WorkspaceProject {
  const archived = project.archivedAgents?.find((item) => item.agent.profile.id === agentId);
  if (!archived) throw new Error('Удалённый агент не найден.');
  if (project.agents.some((item) => item.profile.id === agentId))
    throw new Error('Агент уже есть в проекте.');
  const agents = [...project.agents];
  agents.splice(Math.min(archived.position, agents.length), 0, structuredClone(archived.agent));
  return {
    ...project,
    agents,
    archivedAgents: project.archivedAgents!.filter((item) => item !== archived),
  };
}
