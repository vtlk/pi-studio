import type { AgentRunStatus, ProjectAgent } from './workspace.types';

export type AgentDisplayStatus = AgentRunStatus | 'disabled';

export const agentStatusLabels: Record<AgentDisplayStatus, string> = {
  idle: 'Не запускался',
  running: 'Работает',
  waiting: 'Ожидает вас',
  ready: 'Результат готов · требуется проверка человеком',
  error: 'Ошибка',
  stopped: 'Остановлен',
  disabled: 'Агент выключен',
};

export function getAgentDisplayStatus(agent: ProjectAgent): AgentDisplayStatus {
  return agent.profile.enabled ? (agent.runStatus ?? 'idle') : 'disabled';
}
