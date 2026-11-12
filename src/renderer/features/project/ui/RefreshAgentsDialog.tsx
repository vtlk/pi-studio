import { useState } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { Switch } from '@/shared/ui/SelectionControls';
import { useWorkspace } from '../model/Workspace';
import { compareAgents } from '../model/snapshot';

export function RefreshAgentsDialog({ onClose }: { onClose: () => void }) {
  const { selectedProject, refreshAgents } = useWorkspace();
  const { agents } = useAgentProfiles();
  const { demo } = useNotice();
  const [updateExisting, setUpdateExisting] = useState(false);
  if (!selectedProject) return null;
  const diff = compareAgents(selectedProject.agents, agents);
  const hasChanges = diff.added.length > 0 || (updateExisting && diff.changed.length > 0);
  return (
    <Modal
      title="Перечитать агентов"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!hasChanges}
            onClick={() => {
              refreshAgents(updateExisting);
              demo('Снимок агентов обновлён в памяти прототипа. Выходные файлы сохранены.');
              onClose();
            }}
          >
            Применить
          </Button>
        </>
      }
    >
      <div className="agent-diff">
        {diff.added.length > 0 ? (
          <section>
            <h3>Добавятся в проект</h3>
            <ul>
              {diff.added.map((agent) => (
                <li key={agent.id}>{agent.name || 'Без названия'}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p>Новых агентов нет.</p>
        )}
        {diff.changed.length > 0 && (
          <section>
            <h3>Настройки изменились</h3>
            <ul>
              {diff.changed.map((agent) => (
                <li key={agent.id}>{agent.name || 'Без названия'}</li>
              ))}
            </ul>
            <label className="refresh-existing">
              <span>Обновить эти профили</span>
              <Switch
                label="Обновить изменённые профили"
                checked={updateExisting}
                onChange={setUpdateExisting}
              />
            </label>
          </section>
        )}
        {diff.missing.length > 0 && (
          <section>
            <h3>Убраны из общего списка</h3>
            <ul>
              {diff.missing.map((agent) => (
                <li key={agent.id}>{agent.name || 'Без названия'}</li>
              ))}
            </ul>
            <p>Эти агенты и их файлы останутся в проекте.</p>
          </section>
        )}
        {(diff.added.length > 0 || diff.changed.length > 0) && (
          <p>Существующие выходные файлы сохраняются.</p>
        )}
      </div>
    </Modal>
  );
}
