import { reasoningLabel } from '@/shared/model/localizedProfiles';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { parseReasoning, reasoningLabels, type ThinkingLevel } from '../../../../shared/reasoning';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Select, type SelectOption } from '@/shared/ui/Select';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { useConnections } from '@/features/connections/model/Connections';
import { useAgentProfiles } from '../model/AgentProfiles';
import { usePiCatalog } from '@/features/connections/model/usePiCatalog';

export function ModelPanel() {
  useTranslation(undefined, { i18n });
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
  const reasoning = parseReasoning(model.reasoning) ?? (model.reasoning || 'none');
  const levels = window.studio
    ? (selectedModel?.reasoningLevels ?? [])
    : (Object.keys(reasoningLabels) as ThinkingLevel[]);
  const reasoningOptions: SelectOption[] = [
    { value: 'default', label: t('ModelPanel.default') },
    ...levels.map((value) => ({ value, label: t(`reasoning.${value}`) })),
  ];
  if (!reasoningOptions.some((option) => option.value === reasoning))
    reasoningOptions.push({
      value: reasoning,
      label: model.reasoning
        ? t('ModelPanel.unavailable', { value1: reasoningLabel(model.reasoning) })
        : t('ModelPanel.notSelected'),
      disabled: true,
    });
  const chooseModel = (id: string) => {
    const next = availableModels.find((item) => item.id === id);
    const previous = parseReasoning(model.reasoning);
    update({
      id: id === 'none' ? '' : id,
      reasoning:
        previous && (previous === 'default' || next?.reasoningLevels?.includes(previous))
          ? model.reasoning
          : 'По умолчанию',
    });
  };
  const modelOptions = [
    {
      value: 'none',
      label: !connection
        ? t('ModelPanel.chooseAConnectionFirst')
        : loading
          ? t('ModelPanel.loadingThePiCatalog')
          : t('ModelPanel.selectAModel'),
    },
    ...availableModels.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` })),
    ...(model.id && !selectedModel
      ? [{ value: model.id, label: t('ModelPanel.missingFromTheCatalog', { value1: model.id }) }]
      : []),
  ];
  const options = [
    { value: 'none', label: t('ModelPanel.notSelected') },
    ...connections
      .filter((item) => item.purpose !== 'images')
      .map((item) => ({ value: item.id, label: item.name })),
    ...(model.connectionId && !connection
      ? [{ value: model.connectionId, label: t('ModelPanel.connectionUnavailable') }]
      : []),
  ];
  return (
    <div className="agent-settings-content agent-model-panel">
      <div className="agent-model-fields">
        <label className="field-label">
          <span>{t('ModelPanel.connection')}</span>
          <Select
            label={t('ModelPanel.modelConnection')}
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
          <span>{t('AgentProfileEditor.model')}</span>
          {window.studio ? (
            <SearchableSelect
              label={t('ModelPanel.agentModel')}
              placeholder={t('ModelPanel.selectAModel')}
              searchPlaceholder={t('ModelPanel.searchModels')}
              emptyMessage={t('ModelPanel.noModelsFound')}
              value={model.id || 'none'}
              options={modelOptions}
              onValueChange={chooseModel}
              disabled={!connection || loading}
            />
          ) : (
            <input
              placeholder={t('ModelPanel.modelIdFromThePiCatalog')}
              value={model.id}
              onChange={(event) => update({ id: event.target.value })}
            />
          )}
        </label>
        <label className="field-label">
          <span>{t('ModelPanel.reasoningLevel')}</span>
          <Select
            label={t('ModelPanel.reasoningLevelEffort')}
            options={reasoningOptions}
            value={reasoning}
            disabled={
              !!window.studio &&
              (!selectedModel ||
                (selectedModel.reasoning === false &&
                  (reasoning === 'default' || reasoning === 'off')))
            }
            onValueChange={(reasoning) => update({ reasoning })}
          />
        </label>
      </div>
      {window.studio && (
        <div className="agent-model-actions">
          <Button disabled={loading || !connection} onClick={() => void reload()}>
            <RefreshCw size={15} aria-hidden="true" />
            {loading ? t('ModelPanel.refreshingCatalog') : t('ModelPanel.refreshPiCatalog')}
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
