import { coreTools, coreToolStatus } from '@/entities/studio/tools';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useConnections } from '@/features/connections/model/Connections';
import { useAgentProfiles } from '../model/AgentProfiles';
import { usePiCatalog } from '@/features/connections/model/usePiCatalog';

export function ModelPanel() {
  const { selectedAgent, selectedSystemRole, updateAgent } = useAgentProfiles();
  const { connections, providerStatuses } = useConnections();
  const { catalog, loading, error, reload } = usePiCatalog(
    connections.find((item) => item.id === selectedAgent?.model?.connectionId),
  );
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
  const availableModels =
    catalog?.models.filter((item) => item.provider === connection?.providerId) ?? [];
  const selectedModel = availableModels.find((item) => item.id === model.id);
  const modelOptions = [
    {
      value: 'none',
      label: !connection
        ? 'Сначала подключение'
        : loading
          ? 'Загружаем каталог Pi…'
          : 'Выберите модель',
    },
    ...availableModels.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` })),
    ...(model.id && !selectedModel
      ? [{ value: model.id, label: `${model.id} · отсутствует в каталоге` }]
      : []),
  ];
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
        {coreTools
          .filter((tool) => selectedSystemRole !== 'assistant' || tool.id === 'web-search')
          .map((tool) => `${tool.name} · ${coreToolStatus(tool.id, !!window.studio).toLowerCase()}`)
          .join(', ')}
        .
      </p>
      <div className="agent-model-fields">
        <label className="field-label">
          <span>Подключение</span>
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
        <label className="field-label">
          <span>Модель</span>
          {window.studio ? (
            <Select
              label="Модель агента"
              value={model.id || 'none'}
              options={modelOptions}
              onValueChange={(id) => update({ id: id === 'none' ? '' : id })}
              disabled={!connection || loading}
            />
          ) : (
            <input
              placeholder="ID модели из каталога Pi"
              value={model.id}
              onChange={(event) => update({ id: event.target.value })}
            />
          )}
        </label>
        <label className="field-label">
          <span>Уровень рассуждения</span>
          <Select
            label="Уровень рассуждения (effort)"
            options={
              selectedModel?.reasoning === false
                ? ['По умолчанию']
                : ['По умолчанию', 'Минимальный', 'Низкий', 'Средний', 'Высокий', 'Максимальный']
            }
            value={model.reasoning}
            onValueChange={(reasoning) => update({ reasoning })}
          />
        </label>
      </div>
      <p>
        {connection
          ? `${connection.purpose === 'local' || connection.purpose === 'compatible' ? connection.endpoint : connection.providerId} · ${connection.purpose === 'codex' ? 'Подписка' : 'Собственный способ подключения'}${providerStatuses[connection.id] === 'ready' ? ' · Подключено' : ''}`
          : 'Сначала выберите подключение в первом поле — затем станет доступен список моделей.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {window.studio && (
        <Button disabled={loading} onClick={() => void reload()}>
          Обновить каталог Pi
        </Button>
      )}
      {catalog && (
        <p className="subtle">
          Модели прочитаны из установленного Pi. Доступ к модели проверяется при запросе;
          сохранение профиля не выполняет запрос к модели.
        </p>
      )}
    </div>
  );
}
