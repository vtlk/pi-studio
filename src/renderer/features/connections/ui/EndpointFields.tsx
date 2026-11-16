import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { AddArea } from '@/shared/ui/AddArea';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { ListRow } from '@/shared/ui/ListRow';
import type { Connection } from '../../../../shared/connections';
import type { EndpointModel } from '../../../../shared/modelEndpoint';
export function EndpointFields({
  connection,
  update,
  disabled,
  discover,
}: {
  connection: Connection;
  update: (value: Connection) => void;
  disabled: boolean;
  discover: () => void;
}) {
  useTranslation(undefined, { i18n });
  const config = connection.endpointConfig!;
  const changeModel = (index: number, change: Partial<EndpointModel>) =>
    update({
      ...connection,
      endpointConfig: {
        ...config,
        models: config.models.map((model, i) => (i === index ? { ...model, ...change } : model)),
      },
    });
  return (
    <>
      <label className="field-label">
        {t('EndpointFields.apiAddress')}
        <input
          aria-label={t('EndpointFields.modelApiAddress')}
          disabled={disabled}
          value={connection.endpoint}
          placeholder="http://localhost:1234/v1"
          onChange={(event) => update({ ...connection, endpoint: event.target.value })}
        />
      </label>
      <label className="field-label">
        {t('EndpointFields.protocol')}
        <Select
          label={t('EndpointFields.modelProtocol')}
          disabled={disabled}
          value={config.api}
          options={[
            { value: 'openai-completions', label: 'OpenAI Chat Completions' },
            { value: 'openai-responses', label: 'OpenAI Responses' },
          ]}
          onValueChange={(api) =>
            update({ ...connection, endpointConfig: { ...config, api: api as typeof config.api } })
          }
        />
      </label>
      <label className="field-label">
        {t('EndpointFields.serverAuthentication')}
        <Select
          label={t('EndpointFields.modelServerAuthentication')}
          disabled={disabled}
          value={config.auth}
          options={[
            { value: 'api_key', label: t('EndpointFields.thisConnectionSApiKey') },
            { value: 'none', label: t('EndpointFields.noAuthentication') },
          ]}
          onValueChange={(auth) =>
            update({
              ...connection,
              endpointConfig: { ...config, auth: auth as typeof config.auth },
            })
          }
        />
      </label>
      <Button
        disabled={disabled || !window.studio || !connection.endpoint.trim()}
        onClick={discover}
      >
        {t('EndpointFields.readServerModels')}
      </Button>
      <p className="subtle">{t('EndpointFields.theConnectionIsSavedBeforeReadingThe')}</p>
      <AddArea
        label={t('EndpointFields.addServerModel')}
        disabled={disabled}
        onClick={() =>
          update({
            ...connection,
            endpointConfig: {
              ...config,
              models: [
                ...config.models,
                {
                  id: '',
                  name: '',
                  imageInput: false,
                  reasoning: false,
                  contextWindow: 4096,
                  maxTokens: 1024,
                },
              ],
            },
          })
        }
      />
      <DisclosureList>
        {config.models.map((model, index) => (
          <Disclosure
            key={index}
            label={model.id || t('EndpointFields.newModel')}
            icon={Cpu}
            defaultOpen={!model.id}
            actions={
              <HoverDeleteButton
                disabled={disabled}
                label={uiText('EndpointFields.deleteModel', { value1: model.id || index + 1 })}
                onDelete={() =>
                  update({
                    ...connection,
                    endpointConfig: {
                      ...config,
                      models: config.models.filter((_model, i) => i !== index),
                    },
                  })
                }
              />
            }
          >
            <label className="field-label">
              {t('EndpointFields.modelId')}
              <input
                aria-label={t('EndpointFields.serverModelId', { value1: index + 1 })}
                disabled={disabled}
                value={model.id}
                onChange={(event) => changeModel(index, { id: event.target.value })}
              />
            </label>
            <label className="field-label">
              {t('ConnectionEditor.name')}
              <input
                disabled={disabled}
                value={model.name}
                onChange={(event) => changeModel(index, { name: event.target.value })}
              />
            </label>
            <label className="field-label">
              {t('EndpointFields.contextTokens')}
              <input
                type="number"
                min={1}
                disabled={disabled}
                value={model.contextWindow}
                onChange={(event) =>
                  changeModel(index, { contextWindow: Number(event.target.value) })
                }
              />
            </label>
            <label className="field-label">
              {t('EndpointFields.maximumResponseTokens')}
              <input
                type="number"
                min={1}
                disabled={disabled}
                value={model.maxTokens}
                onChange={(event) => changeModel(index, { maxTokens: Number(event.target.value) })}
              />
            </label>
            <ListRow
              label={t('EndpointFields.acceptsImages')}
              toggle={{
                label: t('EndpointFields.imagesForModel', { value1: index + 1 }),
                disabled,
                checked: model.imageInput,
                onChange: (imageInput) => changeModel(index, { imageInput }),
              }}
            />
            <ListRow
              label={t('EndpointFields.supportsReasoning')}
              toggle={{
                label: t('EndpointFields.reasoningForModel', { value1: index + 1 }),
                disabled,
                checked: model.reasoning,
                onChange: (reasoning) => changeModel(index, { reasoning }),
              }}
            />
          </Disclosure>
        ))}
      </DisclosureList>
    </>
  );
}
