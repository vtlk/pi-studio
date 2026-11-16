import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useAgentProfiles } from '../model/AgentProfiles';
import { useTeamTransfers } from '../model/TeamTransfers';
import { TeamTransferFeedback } from './TeamTransferFeedback';
export function TeamTransferPanel() {
  useTranslation(undefined, { i18n });
  const { teams } = useAgentProfiles();
  const transfer = useTeamTransfers();
  const [teamId, setTeamId] = useState('');
  const { refreshReports } = transfer;
  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);
  return (
    <>
      <h2>{t('TeamTransferPanel.agentTeams')}</h2>
      <p>{t('TeamTransferPanel.transferCurrentSettingsAndResourceFilesKeys')}</p>
      <label className="field-label">
        {t('TeamTransferPanel.teamToExport')}
        <Select
          label={t('TeamTransferPanel.teamToExport')}
          value={teamId}
          onValueChange={setTeamId}
          placeholder={t('TeamTransferPanel.selectATeam')}
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
          {t('TeamTransferPanel.exportAgentTeam')}
        </Button>
        <Button
          kind="primary"
          disabled={transfer.busy || !transfer.available}
          onClick={() => void transfer.importTeam()}
        >
          {t('TeamTransferPanel.importAgentTeam')}
        </Button>
      </div>
      <TeamTransferFeedback {...transfer} />
    </>
  );
}
