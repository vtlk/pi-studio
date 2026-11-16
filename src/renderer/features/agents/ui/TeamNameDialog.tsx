import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { TeamWorkspaceMode } from '../../../../shared/agentTeams';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';

export function TeamNameDialog({
  name = '',
  workspaceMode = 'per-agent',
  onSave,
  onClose,
}: {
  name?: string;
  workspaceMode?: TeamWorkspaceMode;
  onSave: (name: string, workspaceMode: TeamWorkspaceMode) => void;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  const [value, setValue] = useState(name);
  const [mode, setMode] = useState(workspaceMode);
  return (
    <Modal
      title={name ? t('TeamNameDialog.teamSettings') : t('AgentList.createTeam')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('TeamNameDialog.cancel')}</Button>
          <Button
            kind="primary"
            disabled={!value.trim()}
            onClick={() => {
              onSave(value.trim(), mode);
              onClose();
            }}
          >
            {name ? t('TeamNameDialog.save') : t('TeamNameDialog.create')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('TeamNameDialog.teamName')}
        <input
          autoFocus
          aria-label={t('TeamNameDialog.teamName')}
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className="field-label">
        {t('TeamNameDialog.agentWorkingFolders')}
        <Select
          label={t('TeamNameDialog.agentWorkingFolders')}
          value={mode}
          options={[
            { value: 'per-agent', label: t('TeamNameDialog.eachAgentInASeparateFolder') },
            { value: 'shared', label: t('TeamNameDialog.allAgentsInOneFolder') },
          ]}
          onValueChange={(value) => setMode(value as TeamWorkspaceMode)}
        />
      </div>
      <p>
        {mode === 'shared'
          ? t('TeamNameDialog.agentsWorkDirectlyInTheProjectFolder')
          : t('TeamNameDialog.eachAgentHasItsOwnWorkingFolder')}{' '}
        {t('TeamNameDialog.theChangeAppliesTheNextTimeA')}
      </p>
    </Modal>
  );
}
