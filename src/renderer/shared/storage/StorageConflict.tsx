import { t, i18n, type MessageKey } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { StorageSection } from '../../../shared/storage';
import { Button } from '../ui';
import { Modal } from '../ui/Modal';

const sectionNames: Record<StorageSection, MessageKey> = {
  agents: 'Topbar.agents',
  agentTeams: 'TeamTransferPanel.agentTeams',
  agentCatalog: 'StorageConflict.teamsAndAgents',
  systemAgents: 'StorageConflict.systemAgents',
  resources: 'StorageConflict.resources',
  connections: 'ConnectionsPanel.connections',
  imageTool: 'tools.imageGeneration',
  baseInstruction: 'SettingsView.sharedInstructions',
  piPath: 'SettingsView.piPath',
};

export function StorageConflict({
  section,
  reloading,
  onClose,
  onReload,
}: {
  section: StorageSection;
  reloading: boolean;
  onClose: () => void;
  onReload: () => void;
}) {
  useTranslation(undefined, { i18n });
  return (
    <Modal
      title={t('RefreshAgentsDialog.settingsChanged')}
      onClose={onClose}
      alert
      footer={
        <>
          <Button onClick={onClose}>{t('StorageConflict.returnToMyEdits')}</Button>
          <Button disabled={reloading} onClick={onReload}>
            {reloading ? t('StorageConflict.reloading') : t('Storage.reloadSection')}
          </Button>
        </>
      }
    >
      <p>
        {t('StorageConflict.the')}
        {t(sectionNames[section])}
        {t('StorageConflict.sectionHasOtherSavedChangesYourDraft')}
      </p>
      <p>{t('StorageConflict.reloadingReplacesUnsavedChangesInThisSection')}</p>
    </Modal>
  );
}
