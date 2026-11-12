import { coreTools } from '@/entities/studio/tools';
import { EmptyIntegration } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useConnections } from '@/features/connections/model/Connections';
import { useAgentProfiles } from '../model/AgentProfiles';

export function ModelPanel() {
  const { selectedAgent, updateAgent } = useAgentProfiles();
  const { connections } = useConnections();
  if (!selectedAgent) return null;
  const model = selectedAgent.model ?? {
    connectionId: '',
    provider: '',
    id: '',
    reasoning: 'По умолчанию',
    temperature: '',
  };
  const connection = connections.find(
    (item) => item.id === model.connectionId && item.purpose !== 'images',
  );
  const update = (change: Partial<typeof model>) => updateAgent({ model: { ...model, ...change } });
  const options = [
    { value: 'none', label: 'Не выбрано' },
    ...connections
      .filter((item) => item.purpose !== 'images')
      .map((item) => ({ value: item.id, label: item.name })),
    ...(model.connectionId && !connection
      ? [{ value: model.connectionId, label: 'Подключение недоступно' }]
      : []),
  ];
  return (
    <div className="agent-settings-content">
      <p>
        Общие инструменты:{' '}
        {coreTools.map((tool) => `${tool.name} · ${tool.status.toLowerCase()}`).join(', ')}.
      </p>
      <label className="field-label">
        Подключение модели
        <Select
          label="Подключение модели"
          value={model.connectionId || 'none'}
          options={options}
          onValueChange={(id) => {
            const next = connections.find((item) => item.id === id);
            update({
              connectionId: id === 'none' ? '' : id,
              provider: next?.providerId ?? '',
              id: '',
              reasoning: 'По умолчанию',
            });
          }}
        />
      </label>
      <p>
        {connection
          ? `${connection.providerId} · ${connection.purpose === 'codex' ? 'Подписка' : 'Собственный способ подключения'} · не настроено`
          : 'Выберите подключение явно. Автоматической подмены нет.'}
      </p>
      <label className="field-label">
        Модель
        <input
          placeholder="ID модели из каталога Pi"
          value={model.id}
          onChange={(event) => update({ id: event.target.value })}
        />
      </label>
      <label className="field-label">
        Уровень рассуждения (effort)
        <Select
          label="Уровень рассуждения (effort)"
          options={['По умолчанию', 'Низкий', 'Средний', 'Высокий']}
          value={model.reasoning}
          onValueChange={(reasoning) => update({ reasoning })}
        />
      </label>
      <EmptyIntegration>
        Каталог всех провайдеров, моделей и поддерживаемых параметров должен загружаться из Pi.
        Сейчас реестр и авторизация не подключены; примеры не означают полного каталога.
      </EmptyIntegration>
    </div>
  );
}
