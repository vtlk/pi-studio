import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNavigation } from '@/shared/model/Navigation';
import { useNotice } from '@/shared/model/Notice';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';

export function AgentConfigurationDialog({
  agentId,
  onClose,
  onConfigure,
}: {
  agentId: string;
  onClose: () => void;
  onConfigure?: (agentId: string, tab?: string) => void;
}) {
  useTranslation(undefined, { i18n });
  const { agents, systemAgents, setAgentId, setAgentTab } = useAgentProfiles();
  const { navigate } = useNavigation();
  const { demo } = useNotice();
  return (
    <Modal
      title={t('AgentConfigurationDialog.agentConfiguration')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('TeamNameDialog.cancel')}</Button>
          <Button
            kind="primary"
            onClick={() => {
              if (![...agents, ...systemAgents].some((agent) => agent.id === agentId)) {
                demo(uiText('AgentActions.thisAgentWasRemovedFromTheBuilder'));
                return;
              }
              setAgentId(agentId);
              setAgentTab('Модель');
              onClose();
              if (onConfigure) onConfigure(agentId, t('AgentProfileEditor.model'));
              else navigate('agents');
            }}
          >
            {t('AgentConfigurationDialog.goToSettings')}
          </Button>
        </>
      }
    >
      <p>{t('AgentConfigurationDialog.configureTheAgentSConnectionInAgent')}</p>
    </Modal>
  );
}
