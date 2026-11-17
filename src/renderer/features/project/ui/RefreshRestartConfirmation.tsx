import { useTranslation } from 'react-i18next';
import type { AgentRefreshReview } from '../../../../shared/agentRefresh';
import { t, i18n } from '../../../../shared/i18n';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';

export function RefreshRestartConfirmation({
  review,
  busy,
  onClose,
  onConfirm,
}: {
  review: AgentRefreshReview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useTranslation(undefined, { i18n });
  return (
    <Modal
      alert
      title={t('AgentRefresh.confirmTitle')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('TeamNameDialog.cancel')}
          </Button>
          <Button kind="primary" disabled={busy} onClick={onConfirm}>
            {t('AgentRefresh.confirmAction')}
          </Button>
        </>
      }
    >
      <p>{t('AgentRefresh.confirmDescription')}</p>
      <ul>
        {[...review.restarting, ...review.removing]
          .filter((run) => run.working)
          .map((run) => (
            <li key={run.runId}>{run.agentName}</li>
          ))}
      </ul>
      <p>{t('AgentRefresh.preserveDialogue')}</p>
    </Modal>
  );
}
