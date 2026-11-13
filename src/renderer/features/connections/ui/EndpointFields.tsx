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
        Адрес API
        <input
          aria-label="Адрес API модели"
          disabled={disabled}
          value={connection.endpoint}
          placeholder="http://localhost:1234/v1"
          onChange={(event) => update({ ...connection, endpoint: event.target.value })}
        />
      </label>
      <label className="field-label">
        Протокол
        <Select
          label="Протокол модели"
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
        Авторизация сервера
        <Select
          label="Авторизация сервера модели"
          disabled={disabled}
          value={config.auth}
          options={[
            { value: 'api_key', label: 'API-ключ этого подключения' },
            { value: 'none', label: 'Без авторизации' },
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
        Прочитать модели сервера
      </Button>
      <p className="subtle">
        Перед чтением подключение сохраняется. Список сервера сообщает ID моделей. Возможности и
        лимиты укажите по его документации; сохраните подключение перед выбором модели у агента.
        Статус Pi подтверждает настройки авторизации; доступ к модели проверяется при запросе.
      </p>
      <AddArea
        label="Добавить модель сервера"
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
            label={model.id || 'Новая модель'}
            icon={Cpu}
            defaultOpen={!model.id}
            actions={
              <HoverDeleteButton
                disabled={disabled}
                label={`Удалить модель ${model.id || index + 1}`}
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
              ID модели
              <input
                aria-label={`ID модели сервера ${index + 1}`}
                disabled={disabled}
                value={model.id}
                onChange={(event) => changeModel(index, { id: event.target.value })}
              />
            </label>
            <label className="field-label">
              Название
              <input
                disabled={disabled}
                value={model.name}
                onChange={(event) => changeModel(index, { name: event.target.value })}
              />
            </label>
            <label className="field-label">
              Контекст, токенов
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
              Максимум ответа, токенов
              <input
                type="number"
                min={1}
                disabled={disabled}
                value={model.maxTokens}
                onChange={(event) => changeModel(index, { maxTokens: Number(event.target.value) })}
              />
            </label>
            <ListRow
              label="Принимает изображения"
              toggle={{
                label: `Изображения модели ${index + 1}`,
                disabled,
                checked: model.imageInput,
                onChange: (imageInput) => changeModel(index, { imageInput }),
              }}
            />
            <ListRow
              label="Поддерживает рассуждение"
              toggle={{
                label: `Рассуждение модели ${index + 1}`,
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
