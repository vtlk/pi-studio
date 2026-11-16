import { t, type MessageKey } from '../../../shared/i18n/index.ts';
import { parseReasoning } from '../../../shared/reasoning.ts';
import { systemAgentDefinitions, type SystemAgent } from '../../../shared/systemAgents.ts';
import type { Agent } from '../../../shared/studio.ts';

/** IDs and legacy persisted values stay unchanged; all consumers share their display labels. */
const tabKeys: Record<string, MessageKey> = {
  Промпт: 'AgentProfiles.prompt',
  Инструкции: 'AgentProfileEditor.instructions',
  Плагины: 'AgentProfileEditor.plugins',
  Модель: 'AgentProfileEditor.model',
};
export function agentTabLabel(tab: string): string {
  return tabKeys[tab] ? t(tabKeys[tab]) : tab;
}
export function reasoningLabel(value: string | undefined): string {
  const level = parseReasoning(value);
  return level === 'default'
    ? t('ModelPanel.default')
    : level
      ? t(`reasoning.${level}`)
      : (value ?? '');
}
export function agentName(agent: Agent): string {
  const role = (agent as Partial<SystemAgent>).systemRole;
  return role === 'assistant' && agent.name === systemAgentDefinitions.assistant.name
    ? t('builtin.assistant.name')
    : agent.name;
}
