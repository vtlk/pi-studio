import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useNavigation } from '@/shared/model/Navigation';

export function NewProjectDialog() {
  const [name, setName] = useState('');
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
            disabled={busy || !name.trim()}
            onClick={async () => {
              if ((await createProject(name)) === false) return;
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
    </Modal>
  );
}
