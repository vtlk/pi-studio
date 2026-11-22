import { t, type MessageKey } from '../../../../shared/i18n/index.ts';
import type { AgentRunStatus, ProjectAgent } from './workspace.types';
import { failureLabel } from '../../../shared/model/localizedFailures.ts';

export type AgentDisplayStatus = AgentRunStatus | 'disabled';

export const agentStatusLabels: Record<AgentDisplayStatus, MessageKey> = {
  idle: 'agentActivity.notStarted',
  running: 'agentActivity.working',
  waiting: 'agentActivity.waitingForAMessageInPi',
  ready: 'agentActivity.resultReady',
  error: 'agentActivity.error',
  stopped: 'agentActivity.workStopped',
  disabled: 'agentActivity.agentDisabled',
};

export function getAgentStatusLabel(
  agent: ProjectAgent,
  status = getAgentDisplayStatus(agent),
): string {
  if (status === 'error' && agent.runFailure) return failureLabel(agent.runFailure);
  return status === 'stopped' && agent.session
    ? t('agentActivity.dialogueSaved')
    : t(agentStatusLabels[status]);
}

export function getAgentDisplayStatus(agent: ProjectAgent, working = false): AgentDisplayStatus {
  return agent.profile.enabled
    ? working
      ? 'running'
      : (agent.runStatus ?? (agent.session ? 'stopped' : 'idle'))
    : 'disabled';
}
