import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useConfirm } from '@/shared/model/Confirm';
import { useNavigation } from '@/shared/model/Navigation';
import { uiText } from '@/shared/model/UiText';
import { validateAgentModel } from '../../../../shared/modelConfiguration.ts';

/** Both entry points use the same save-before-open path and the one canonical service dialogue. */
export function useOpenSetupAssistant() {
  useTranslation(undefined, { i18n });
  const { saveNow } = useStorage();
  const { systemAgents } = useAgentProfiles();
  const { connections } = useConnections();
  const { confirm } = useConfirm();
  const { openSettings } = useNavigation();
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (openingRef.current) return;
    const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
    if (assistant && !validateAgentModel(assistant.model, connections).ok) {
      setError('');
      confirm({
        title: uiText('ConnectionsPanel.connections'),
        description: uiText('useOpenSetupAssistant.configureModel'),
        confirmLabel: uiText('AgentConfigurationDialog.goToSettings'),
        onConfirm: () => openSettings('connections'),
      });
      return;
    }
    openingRef.current = true;
    setOpening(true);
    setError('');
    try {
      if (!window.studio)
        throw new Error(t('useOpenSetupAssistant.theAssistantIsAvailableInTheMacos'));
      if (!(await saveNow())) throw new Error(t('TeamTransfers.waitForSettingsToFinishSaving'));
      await window.studio.openSetupAssistant();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('useOpenSetupAssistant.couldNotOpenTheAssistant');
      setError(
        message.replace(
          /^Error invoking remote method 'studio:(?:open-)?setup-assistant': (?:Error: )?/,
          '',
        ),
      );
      return message;
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  return { open, opening, error, clearError: () => setError('') };
}
