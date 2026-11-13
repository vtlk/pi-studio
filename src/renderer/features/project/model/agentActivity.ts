import type { AgentRunStatus, ProjectAgent } from './workspace.types';

export type AgentDisplayStatus = AgentRunStatus | 'disabled';

export const agentStatusLabels: Record<AgentDisplayStatus, string> = {
  idle: 'Не запускался',
  running: 'Работает',
  waiting: 'Ожидает вашего сообщения или подтверждения в Pi',
  ready: 'Результат готов · требуется проверка человеком',
  error: 'Ошибка',
  stopped: 'Pi закрыт или работа остановлена',
  disabled: 'Агент выключен',
};

export function getAgentDisplayStatus(agent: ProjectAgent): AgentDisplayStatus {
  return agent.profile.enabled
    ? (agent.runStatus ?? (agent.session ? 'stopped' : 'idle'))
    : 'disabled';
}
