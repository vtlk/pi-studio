import type { ProjectAgent, SessionBinding } from './workspace.types';

export type AgentLaunchAction =
  | { kind: 'start' }
  | { kind: 'resume'; session: SessionBinding }
  | { kind: 'blocked'; reason: string };

export function getAgentLaunchAction(agent: ProjectAgent): AgentLaunchAction {
  if (!agent.profile.enabled) return { kind: 'blocked', reason: 'Агент выключен.' };
  if (!agent.session) return { kind: 'start' };
  if (agent.session.missing || !agent.session.path.trim())
    return {
      kind: 'blocked',
      reason: 'Сессия агента недоступна. Восстановите её файл; новый диалог не создаётся.',
    };
  return { kind: 'resume', session: agent.session };
}
