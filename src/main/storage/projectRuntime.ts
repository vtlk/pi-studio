import { t } from '../../shared/i18n/index.ts';
import type {
  ProjectAgent,
  AgentRunStatus,
  SessionBinding,
  WorkspaceProject,
} from '../../shared/project.ts';
import type { RunFailure } from '../../shared/runFailure.ts';

export function withAgentRuntime(
  agent: ProjectAgent,
  status: AgentRunStatus,
  session?: SessionBinding | null,
  failure?: RunFailure,
): ProjectAgent {
  return {
    ...agent,
    runStatus: status,
    runFailure: status === 'error' ? (failure ?? agent.runFailure) : undefined,
    ...(session === null ? { session: undefined } : session ? { session } : {}),
  };
}

export function withFork(agent: ProjectAgent): ProjectAgent {
  return { ...agent, session: agent.session ? { ...agent.session, needsFork: true } : undefined };
}

export function withAgentModel(
  project: WorkspaceProject,
  agentId: string,
  model: NonNullable<ProjectAgent['profile']['model']>,
) {
  const selected = project.agents.find((agent) => agent.profile.id === agentId);
  if (!selected) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
  if (JSON.stringify(selected.profile.model) === JSON.stringify(model)) return project;
  return {
    ...project,
    agents: project.agents.map((agent) =>
      agent === selected
        ? { ...agent, profile: { ...agent.profile, model: structuredClone(model) } }
        : agent,
    ),
  };
}

export function withProjectRuntime(
  project: WorkspaceProject,
  agentId: string,
  status: AgentRunStatus,
  session?: SessionBinding | null,
  failure?: RunFailure,
) {
  const selected = project.agents.find((item) => item.profile.id === agentId);
  if (!selected) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
  return {
    ...project,
    agents: project.agents.map((item) =>
      item === selected ? withAgentRuntime(item, status, session, failure) : item,
    ),
  };
}
