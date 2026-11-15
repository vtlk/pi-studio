import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { Disclosure } from '@/shared/ui/Disclosure';
import { useStorage } from '@/shared/storage/Storage';
import { useAgentProfiles } from '../model/AgentProfiles';
import { AgentConfigurationDialog } from '@/features/project/ui/AgentConfigurationDialog';
import type { TeamImportReport, TeamSetupResult } from '../../../../shared/teamPackage';

export function TeamTransferPanel() {
  const { teams } = useAgentProfiles();
  const { bootstrap, saveNow } = useStorage();
  const [teamId, setTeamId] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [reports, setReports] = useState<TeamImportReport[]>([]),
    [configure, setConfigure] = useState('');
  const folder = bootstrap?.folder;
  const refresh = useCallback(async () => {
    if (!window.studio || !folder) return;
    setReports(await window.studio.listTeamImports(folder));
  }, [folder]);
  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Не прочитаны импорты.'),
    );
  }, [refresh]);
  const receive = (result: TeamSetupResult) => {
    setReports((previous) => [
      result.report,
      ...previous.filter((report) => report.id !== result.report.id),
    ]);
    if (result.outcome === 'needs_configuration') setConfigure(result.assistantId);
    setMessage(
      result.message ??
        (result.outcome === 'opened'
          ? 'Пакет сохранён. Помощник открыт для настройки команды.'
          : result.outcome === 'needs_configuration'
            ? 'Пакет сохранён. Сначала настройте модель помощника.'
            : 'Пакет сохранён. Передача задания не подтверждена; автоматического повтора нет. Продолжите в открытом диалоге помощника.'),
    );
  };
  const action = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (!(await saveNow())) throw new Error('Дождитесь сохранения настроек.');
      await task();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : 'Операция не завершена.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Команды агентов</h2>
      <p>
        Перенос текущих настроек и файлов ресурсов. Ключи, истории Pi и результаты проектов в пакет
        не входят.
      </p>
      <label className="field-label">
        Команда для экспорта
        <Select
          label="Команда для экспорта"
          value={teamId}
          onValueChange={setTeamId}
          placeholder="Выберите команду"
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
        />
      </label>
      <div className="action-row">
        <Button
          disabled={busy || !window.studio || !folder || !teams.some((team) => team.id === teamId)}
          onClick={() =>
            void action(async () => {
              const result = await window.studio!.exportAgentTeam({ folder: folder!, teamId });
              if (result)
                setMessage(
                  `Пакет сохранён.${result.requirements.length ? ' Внешние зависимости перечислены в manifest: ' + result.requirements.join(' ') : ''}`,
                );
            })
          }
        >
          Экспорт команды агентов
        </Button>
        <Button
          kind="primary"
          disabled={busy || !window.studio || !folder}
          onClick={() =>
            void action(async () => {
              const result = await window.studio!.importAgentTeam(folder!);
              if (result) receive(result);
            })
          }
        >
          Импорт команды агентов
        </Button>
      </div>
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
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                receive(
                  await window.studio!.continueTeamImport({ folder: folder!, id: report.id }),
                ),
              )
            }
          >
            Продолжить настройку
          </Button>
        </Disclosure>
      ))}
      {configure && (
        <AgentConfigurationDialog agentId={configure} onClose={() => setConfigure('')} />
      )}
    </>
  );
}
