import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';

/** Both entry points use the same save-before-open path and the one canonical service dialogue. */
export function useOpenSetupAssistant() {
  useTranslation(undefined, { i18n });
  const { saveNow } = useStorage();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (opening) return;
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
      setError(message);
      return message;
    } finally {
      setOpening(false);
    }
  };
  return { open, opening, error };
}
