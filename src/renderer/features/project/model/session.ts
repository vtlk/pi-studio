import { t } from '../../../../shared/i18n/index.ts';
import type { ProjectAgent, SessionBinding } from './workspace.types';

export type AgentLaunchAction =
  | { kind: 'start' }
  | { kind: 'resume'; session: SessionBinding }
  | { kind: 'blocked'; reason: string };

export function getAgentLaunchAction(agent: ProjectAgent): AgentLaunchAction {
  if (!agent.profile.enabled) return { kind: 'blocked', reason: t('session.agentDisabled') };
  if (!agent.session) return { kind: 'start' };
  if (agent.session.missing || !agent.session.path.trim())
    return {
      kind: 'blocked',
      reason: t('session.theAgentSessionIsUnavailableRestoreIts'),
    };
  return { kind: 'resume', session: agent.session };
}
