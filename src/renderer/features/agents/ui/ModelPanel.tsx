import { coreTools } from '@/entities/studio/tools';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useConnections } from '@/features/connections/model/Connections';
import { useAgentProfiles } from '../model/AgentProfiles';
import { usePiCatalog } from '@/features/connections/model/usePiCatalog';

export function ModelPanel() {
  const { selectedAgent, updateAgent } = useAgentProfiles();
  const { connections } = useConnections();
  const { catalog, loading, error, reload } = usePiCatalog();
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
    { value: 'none', label: loading ? 'Загружаем каталог Pi…' : 'Выберите модель' },
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
          ? `${connection.providerId} · ${connection.purpose === 'codex' ? 'Подписка' : 'Собственный способ подключения'}`
          : 'Выберите подключение явно. Автоматической подмены нет.'}
      </p>
      <label className="field-label">
        Модель
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
        Уровень рассуждения (effort)
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
      {error && <p role="alert">{error}</p>}
      {window.studio && (
        <Button disabled={loading} onClick={() => void reload()}>
          Обновить каталог Pi
        </Button>
      )}
      {catalog && (
        <p className="subtle">
          Модели прочитаны из установленного Pi. Доступ аккаунта проверяется перед запуском;
          сохранение профиля не выполняет запрос к модели.
        </p>
      )}
    </div>
  );
}
