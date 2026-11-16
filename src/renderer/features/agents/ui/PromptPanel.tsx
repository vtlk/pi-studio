import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { useAgentProfiles } from '../model/AgentProfiles';

export function PromptPanel() {
  useTranslation(undefined, { i18n });
  const { selectedAgent, updateAgent } = useAgentProfiles();
  if (!selectedAgent) return null;
  return (
    <div className="agent-prompt-panel">
      <Textarea
        aria-label={t('PromptPanel.agentSMainPrompt')}
        value={selectedAgent.mainInstruction ?? ''}
        onChange={(event) => updateAgent({ mainInstruction: event.target.value })}
        placeholder={t('PromptPanel.agentTaskAndWorkingRules')}
      />
    </div>
  );
}
