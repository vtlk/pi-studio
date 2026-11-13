import type { AgentRunStatus } from '../../shared/project.ts';

/** Closing an idle dialogue stops waiting; validated results and errors remain visible. */
export function closedRunStatus(status: AgentRunStatus): AgentRunStatus {
  return status === 'running' || status === 'waiting' ? 'stopped' : status;
}
