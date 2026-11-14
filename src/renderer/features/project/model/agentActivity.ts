import type { AgentRunStatus, ProjectAgent } from './workspace.types';
import { runFailureLabels } from '../../../../shared/runFailure.ts';

export type AgentDisplayStatus = AgentRunStatus | 'disabled';

export const agentStatusLabels: Record<AgentDisplayStatus, string> = {
  idle: 'Не запускался',
  running: 'Работает',
  waiting: 'Ожидает сообщения в Pi',
  ready: 'Результат готов',
  error: 'Ошибка',
  stopped: 'Работа остановлена',
  disabled: 'Агент выключен',
};

export function getAgentStatusLabel(agent: ProjectAgent): string {
  const status = getAgentDisplayStatus(agent);
  if (status === 'error' && agent.runFailure) return runFailureLabels[agent.runFailure];
  return status === 'stopped' && agent.session ? 'Диалог сохранён' : agentStatusLabels[status];
}

export function getAgentDisplayStatus(agent: ProjectAgent): AgentDisplayStatus {
  return agent.profile.enabled
    ? (agent.runStatus ?? (agent.session ? 'stopped' : 'idle'))
    : 'disabled';
}
