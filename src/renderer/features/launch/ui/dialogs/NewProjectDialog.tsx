import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useNavigation } from '@/shared/model/Navigation';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { Select } from '@/shared/ui/Select';

export function NewProjectDialog() {
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const { teams } = useAgentProfiles();
  const { setDialog } = useLaunch();
  const { createProject, busy } = useWorkspace();
  const { navigate } = useNavigation();
  return (
    <Modal
      title="Создать проект"
      onClose={() => {
        if (!busy) setDialog(null);
      }}
      footer={
        <>
          <Button disabled={busy} onClick={() => setDialog(null)}>
            Отмена
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
            Создать
          </Button>
        </>
      }
    >
      <label className="field-label">
        Название проекта
        <input
          autoFocus
          aria-label="Название проекта"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Название"
        />
      </label>
      <label className="field-label">
        Команда агентов
        <Select
          label="Команда агентов"
          value={teamId}
          onValueChange={setTeamId}
          placeholder="Выберите команду"
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
        />
      </label>
      {!teams.length && (
        <p>
          Сначала создайте команду агентов.{' '}
          <Button
            onClick={() => {
              setDialog(null);
              navigate('agents');
            }}
          >
            Перейти к агентам
          </Button>
        </p>
      )}
    </Modal>
  );
}
