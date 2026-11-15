import { useState } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { Switch } from '@/shared/ui/SelectionControls';
import { useWorkspace } from '../model/Workspace';
import { compareAgents } from '../model/snapshot';
import { useStorage } from '@/shared/storage/Storage';

export function RefreshAgentsDialog({ onClose }: { onClose: () => void }) {
  const { selectedProject, refreshAgents, restoreProjectAgent, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const { agents: allAgents, teams } = useAgentProfiles();
  const { demo } = useNotice();
  const [updateExisting, setUpdateExisting] = useState(false);
  if (!selectedProject) return null;
  const team = teams.find((team) => team.id === selectedProject.sourceTeamId);
  const agents =
    team?.agentIds.flatMap((id) => allAgents.find((agent) => agent.id === id) ?? []) ?? [];
  const diff = compareAgents(selectedProject.agents, agents);
  const hasChanges =
    diff.added.length > 0 ||
    diff.missing.length > 0 ||
    diff.reordered ||
    (updateExisting && diff.changed.length > 0);
  return (
    <Modal
      title="Перечитать агентов"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            kind="primary"
            disabled={busy || !team || !hasChanges}
            onClick={async () => {
              if ((await refreshAgents(updateExisting)) === false) return;
              demo(
                isDesktop
                  ? 'Список агентов синхронизирован. Файлы и история Pi сохранены.'
                  : 'Снимок агентов обновлён в памяти прототипа.',
                diff.missing.length
                  ? {
                      label: 'Вернуть удалённых',
                      onClick: async () => {
                        for (const agent of diff.missing)
                          await restoreProjectAgent(selectedProject.id, agent.id);
                      },
                    }
                  : undefined,
              );
              onClose();
            }}
          >
            Применить
          </Button>
        </>
      }
    >
      <div className="agent-diff">
        {!team ? (
          <p role="alert">
            Исходная команда удалена или отсутствует. Синхронизация недоступна; файлы и диалоги
            проекта сохранены.
          </p>
        ) : (
          <p>Команда: {team.name}</p>
        )}
        {team &&
          (diff.added.length > 0 ? (
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
          ))}
        {team && diff.changed.length > 0 && (
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
        {team && diff.missing.length > 0 && (
          <section>
            <h3>Уберутся из проекта</h3>
            <ul>
              {diff.missing.map((agent) => (
                <li key={agent.id}>{agent.name || 'Без названия'}</li>
              ))}
            </ul>
            <p>
              Этих агентов больше нет во вкладке «Агенты». Их выходные файлы и история Pi
              сохранятся.
            </p>
          </section>
        )}
        {team && diff.reordered && <p>Порядок этапов будет соответствовать исходной команде.</p>}
        {(diff.added.length > 0 || diff.changed.length > 0 || diff.missing.length > 0) && (
          <p>Существующие выходные файлы сохраняются.</p>
        )}
      </div>
    </Modal>
  );
}
