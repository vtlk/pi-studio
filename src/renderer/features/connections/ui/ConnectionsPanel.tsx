import { useState } from 'react';
import { AddArea } from '@/shared/ui/AddArea';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useConnections, type Connection } from '../model/Connections';
import { ConnectionEditor } from './ConnectionEditor';
import { ImageToolSettings } from './ImageToolSettings';
export function ConnectionsPanel() {
  const { connections, saveConnection, removeConnection, imageTool, providerStatuses } =
    useConnections();
  const { agents } = useAgentProfiles();
  const { projects } = useWorkspace();
  const { demo } = useNotice();
  const [edit, setEdit] = useState<Connection | null>(null);
  return (
    <>
      <h2>Подключения</h2>
      <p>
        У каждого агента одна модель и одно подключение. Здесь настраиваются доступные подключения
        для выбора модели и общих инструментов студии.
      </p>
      <div className="resource-catalog">
        <AddArea
          label="Добавить подключение"
          onClick={() =>
            setEdit({
              id: crypto.randomUUID(),
              name: '',
              purpose: 'pi',
              providerId: '',
              endpoint: '',
              account: '',
              createdAt: Date.now(),
            })
          }
        />
        {connections.map((connection) => {
          const uses = (agent: Pick<(typeof agents)[number], 'model'>) =>
            agent.model?.connectionId === connection.id;
          const users = agents.filter(uses).map((agent) => agent.name);
          const projectUsers = projects
            .filter((project) => project.agents.some((agent) => uses(agent.profile)))
            .map((project) => project.name);
          return (
            <div className="resource-row" key={connection.id} data-removable>
              <div>
                <strong>{connection.name}</strong>
                <p>
                  {connection.providerId} ·{' '}
                  {connection.purpose === 'codex'
                    ? 'Подписка'
                    : connection.purpose === 'images'
                      ? 'Оплачиваемый API'
                      : 'Способ входа из Pi'}
                </p>
                <small>
                  {providerStatuses[connection.providerId] === 'ready'
                    ? 'Pi: авторизация доступна'
                    : providerStatuses[connection.providerId] === 'not_ready'
                      ? 'Pi: требуется вход'
                      : providerStatuses[connection.providerId] === 'invalid'
                        ? 'Pi: ошибка авторизации'
                        : 'Авторизация не проверена'}
                </small>
              </div>
              <Button onClick={() => setEdit(connection)}>Настроить</Button>
              <HoverDeleteButton
                label={`Удалить подключение ${connection.name}`}
                description={`Агенты: ${users.join(', ') || 'нет'}. Проекты: ${projectUsers.join(', ') || 'нет'}. Инструмент генерации изображений: ${imageTool.connectionId === connection.id ? 'использует подключение' : 'не использует'}. Ссылки сохранятся как недоступные. Отзыв доступа у провайдера — отдельное действие; в макете он не выполняется.`}
                onDelete={() => {
                  removeConnection(connection.id);
                  demo('Подключение убрано из макета.', {
                    label: 'Вернуть',
                    onClick: () => saveConnection(connection),
                  });
                }}
              />
            </div>
          );
        })}
        {edit && <ConnectionEditor key={edit.id} connection={edit} onClose={() => setEdit(null)} />}
      </div>
      <ImageToolSettings />
    </>
  );
}
