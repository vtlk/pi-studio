import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useAgentProfiles } from '../model/AgentProfiles';
import { useTeamTransfers } from '../model/TeamTransfers';
import { TeamTransferFeedback } from './TeamTransferFeedback';
export function TeamTransferPanel() {
  const { teams } = useAgentProfiles();
  const transfer = useTeamTransfers();
  const [teamId, setTeamId] = useState('');
  const { refreshReports } = transfer;
  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);
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
          disabled={
            transfer.busy || !transfer.available || !teams.some((team) => team.id === teamId)
          }
          onClick={() => void transfer.exportTeam(teamId)}
        >
          Экспорт команды агентов
        </Button>
        <Button
          kind="primary"
          disabled={transfer.busy || !transfer.available}
          onClick={() => void transfer.importTeam()}
        >
          Импорт команды агентов
        </Button>
      </div>
      <TeamTransferFeedback {...transfer} />
    </>
  );
}
