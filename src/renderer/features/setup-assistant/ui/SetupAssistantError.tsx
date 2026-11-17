import { useTranslation } from 'react-i18next';
import { i18n } from '../../../../shared/i18n/index.ts';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';

/** Keep launch failures readable until dismissed, from either helper entry point. */
export function SetupAssistantError({ error, onClose }: { error: string; onClose: () => void }) {
  const { t } = useTranslation(undefined, { i18n });
  if (!error) return null;
  return (
    <Modal
      alert
      title={t('useOpenSetupAssistant.couldNotOpenTheAssistant')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('Modal.closeWindow')}</Button>}
    >
      <p role="alert">{error}</p>
    </Modal>
  );
}
