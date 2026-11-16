import { t, i18n } from '../../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useNavigation } from '@/shared/model/Navigation';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { Select } from '@/shared/ui/Select';

export function NewProjectDialog() {
  useTranslation(undefined, { i18n });
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const { teams } = useAgentProfiles();
  const { setDialog } = useLaunch();
  const { createProject, busy } = useWorkspace();
  const { navigate } = useNavigation();
  return (
    <Modal
      title={t('NewProjectDialog.createProject')}
      onClose={() => {
        if (!busy) setDialog(null);
      }}
      footer={
        <>
          <Button disabled={busy} onClick={() => setDialog(null)}>
            {t('TeamNameDialog.cancel')}
          </Button>
          <Button
            kind="primary"
            disabled={busy || !name.trim() || !teams.some((team) => team.id === teamId)}
            onClick={async () => {
              if ((await createProject(name, teamId)) === false) return;
              setDialog(null);
              navigate('project');
            }}
          >
            {t('TeamNameDialog.create')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('NewProjectDialog.projectName')}
        <input
          autoFocus
          aria-label={t('NewProjectDialog.projectName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('ConnectionEditor.name')}
        />
      </label>
      <label className="field-label">
        {t('NewProjectDialog.agentTeam')}
        <Select
          label={t('NewProjectDialog.agentTeam')}
          value={teamId}
          onValueChange={setTeamId}
          placeholder={t('TeamTransferPanel.selectATeam')}
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
        />
      </label>
      {!teams.length && (
        <p>
          {t('NewProjectDialog.createAnAgentTeamFirst')}{' '}
          <Button
            onClick={() => {
              setDialog(null);
              navigate('agents');
            }}
          >
            {t('NewProjectDialog.goToAgents')}
          </Button>
        </p>
      )}
    </Modal>
  );
}
