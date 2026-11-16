import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import type { TeamTransfersValue } from '../model/TeamTransfers';
export function TeamTransferFeedback({
  message,
  reports,
  busy,
  continueImport,
}: Pick<TeamTransfersValue, 'message' | 'reports' | 'busy' | 'continueImport'>) {
  useTranslation(undefined, { i18n });
  return (
    <>
      {message && <p role="status">{message}</p>}
      {reports.map((report) => (
        <Disclosure key={report.id} label={report.teamName}>
          <p>
            {report.handoff === 'pending'
              ? t('TeamTransferFeedback.waitingForAssistantSetup')
              : report.handoff === 'sent'
                ? t('TeamTransferFeedback.packageReceivedByTheAssistant')
                : report.handoff === 'sending'
                  ? t('TeamTransferFeedback.waitingForPackageReceiptConfirmation')
                  : t('TeamTransferFeedback.deliveryUnconfirmed')}
          </p>
          {report.agents.map((agent) => (
            <div key={agent.agentId}>
              <strong>{agent.name}</strong>
              {agent.issues.length ? (
                <ul>
                  {agent.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>{t('TeamTransferFeedback.connectionAndAssignedResourcesChecked')}</p>
              )}
            </div>
          ))}
          <Button disabled={busy} onClick={() => void continueImport(report.id)}>
            {t('TeamTransferFeedback.continueSetup')}
          </Button>
        </Disclosure>
      ))}
    </>
  );
}
