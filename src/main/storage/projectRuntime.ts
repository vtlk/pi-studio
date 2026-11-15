import type { ProjectAgent, AgentRunStatus, SessionBinding } from '../../shared/project.ts';
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
