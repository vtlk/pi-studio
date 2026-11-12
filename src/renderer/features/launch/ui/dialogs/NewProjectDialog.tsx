import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useNavigation } from '@/shared/model/Navigation';

export function NewProjectDialog() {
  const [name, setName] = useState('');
  const { setDialog } = useLaunch();
  const { createProject } = useWorkspace();
  const { navigate } = useNavigation();
  return (
    <Modal
      title="Создать проект"
      onClose={() => setDialog(null)}
      footer={
        <>
          <Button onClick={() => setDialog(null)}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!name.trim()}
            onClick={() => {
              createProject(name);
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
