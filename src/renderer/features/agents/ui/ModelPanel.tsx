import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { useConnections } from '@/features/connections/model/Connections';
import { useAgentProfiles } from '../model/AgentProfiles';
import { usePiCatalog } from '@/features/connections/model/usePiCatalog';

export function ModelPanel() {
  const { selectedAgent, updateAgent } = useAgentProfiles();
  const { connections } = useConnections();
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
    <div className="agent-settings-content agent-model-panel">
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
            <SearchableSelect
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
      {window.studio && (
        <div className="agent-model-actions">
          <Button disabled={loading || !connection} onClick={() => void reload()}>
            <RefreshCw size={15} aria-hidden="true" />
            {loading ? 'Обновляем каталог…' : 'Обновить каталог Pi'}
          </Button>
        </div>
      )}
      {error && (
        <p className="agent-model-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
