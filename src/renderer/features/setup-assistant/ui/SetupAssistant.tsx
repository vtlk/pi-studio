import { reasoningLabel } from '@/shared/model/localizedProfiles';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useNavigation } from '@/shared/model/Navigation';
import { useOpenSetupAssistant } from '../model/useOpenSetupAssistant';
import { SetupAssistantError } from './SetupAssistantError';

export function SetupAssistant() {
  useTranslation(undefined, { i18n });
  const { systemAgents, setAgentId, setAgentTab } = useAgentProfiles();
  const { connections } = useConnections();
  const { navigate } = useNavigation();
  const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
  const model = assistant?.model;
  const connection = connections.find((item) => item.id === model?.connectionId);
  const { open, opening, error, clearError } = useOpenSetupAssistant();
  return (
    <>
      <h2>{t('SettingsView.connectionAssistant')}</h2>
      <p>{t('SetupAssistant.connectSkillsMcpServersAndPiPackages')}</p>
      <p aria-label={t('SetupAssistant.connectionAssistantModel')}>
        {t('SetupAssistant.connection')}
        {connection?.name ||
          (model?.connectionId ? t('SetupAssistant.unavailable') : t('SetupAssistant.notSelected'))}
        {' · '}
        {t('SetupAssistant.model')}
        {model?.id || t('PromptDialog.notSelected')}
        {' · '}
        {t('SetupAssistant.reasoningLevel')}
        {reasoningLabel(model?.reasoning) || t('SetupAssistant.notSelected2')}
      </p>
      <div className="action-row">
        <Button
          disabled={!assistant || opening}
          onClick={() => {
            if (!assistant) return;
            setAgentId(assistant.id);
            setAgentTab('Модель');
            navigate('agents');
          }}
        >
          {t('SetupAssistant.assistantModelSettings')}
        </Button>
        <Button
          kind="primary"
          disabled={opening || !assistant?.enabled}
          onClick={() => void open()}
        >
          {opening ? t('AgentActions.openingPi') : t('SetupAssistantAction.openAssistantInPi')}
        </Button>
      </div>
      <SetupAssistantError error={error} onClose={clearError} />
    </>
  );
}
