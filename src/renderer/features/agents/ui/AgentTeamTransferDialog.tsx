import { useTranslation } from 'react-i18next';
import { t, i18n } from '../../../../shared/i18n';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
export function AgentTeamTransferDialog({
  name,
  team,
  onClose,
  onChoose,
}: {
  name: string;
  team: string;
  onClose: () => void;
  onChoose: (copy: boolean) => void;
}) {
  useTranslation(undefined, { i18n });
  return (
    <Modal
      title={t('AgentTeamTransfer.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('TeamNameDialog.cancel')}</Button>
          <Button onClick={() => onChoose(true)}>{t('AgentTeamTransfer.copy')}</Button>
          <Button kind="primary" onClick={() => onChoose(false)}>
            {t('AgentTeamTransfer.move')}
          </Button>
        </>
      }
    >
      <p>{t('AgentTeamTransfer.description', { name, team })}</p>
    </Modal>
  );
}
