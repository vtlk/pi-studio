import { Button } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import type { TeamTransfersValue } from '../model/TeamTransfers';
export function TeamTransferFeedback({
  message,
  reports,
  busy,
  continueImport,
}: Pick<TeamTransfersValue, 'message' | 'reports' | 'busy' | 'continueImport'>) {
  return (
    <>
      {message && <p role="status">{message}</p>}
      {reports.map((report) => (
        <Disclosure key={report.id} label={report.teamName}>
          <p>
            {report.handoff === 'pending'
              ? 'Ожидает настройки помощником'
              : report.handoff === 'sent'
                ? 'Пакет получен помощником'
                : report.handoff === 'sending'
                  ? 'Ожидается подтверждение получения пакета'
                  : 'Передача не подтверждена'}
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
                <p>Подключение и назначенные ресурсы проверены.</p>
              )}
            </div>
          ))}
          <Button disabled={busy} onClick={() => void continueImport(report.id)}>
            Продолжить настройку
          </Button>
        </Disclosure>
      ))}
    </>
  );
}
