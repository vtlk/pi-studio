import { getStudioApi } from '@/shared/desktopApi';
import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
import { useConnections, type Connection } from '../model/Connections';
import { usePiCatalog } from '../model/usePiCatalog';
import { useStorage } from '@/shared/storage/Storage';
import { ImageKeyFields } from './ImageKeyFields';
import { NativeConnectionAuth } from './NativeConnectionAuth';
import { EndpointFields } from './EndpointFields';
import { endpointProviderId } from '../../../../shared/modelEndpoint';

export function ConnectionEditor({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    connection.purpose === 'compatible' || connection.purpose === 'local'
      ? {
          ...connection,
          providerId: endpointProviderId(connection.id),
          authScope: 'connection' as const,
          endpointConfig: connection.endpointConfig ?? {
            api: 'openai-completions' as const,
            auth: connection.purpose === 'local' ? ('none' as const) : ('api_key' as const),
            models: [],
          },
        }
      : connection,
  );
  const { catalog, loading, error, reload } = usePiCatalog();
  const { saveConnection, refreshImageConnection } = useConnections();
  const { bootstrap, saveNow } = useStorage();
  const { demo } = useNotice();
  const [imageKey, setImageKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [authActive, setAuthActive] = useState(false);
  const custom = draft.purpose === 'compatible' || draft.purpose === 'local';
  const provider = custom
    ? {
        id: draft.providerId,
        name: draft.name,
        configured: false,
        subscription: false,
        isolatedAuth: true,
        loginMethods:
          draft.endpointConfig?.auth === 'api_key'
            ? [{ id: 'api_key' as const, label: 'API-ключ' }]
            : [],
      }
    : catalog?.providers.find((item) => item.id === draft.providerId);
  const save = async () => {
    if (!draft.name.trim() || !draft.providerId.trim())
      throw new Error('Укажите название и провайдера подключения.');
    saveConnection(draft);
    if (!(await saveNow())) throw new Error('Сначала сохраните настройки подключения.');
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      title={connection.name || 'Добавить подключение'}
      onClose={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            Отмена
          </Button>
          <Button
            kind="primary"
            disabled={busy || authActive || !draft.name.trim() || !draft.providerId.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await save();
                if (draft.purpose === 'images' && imageKey && window.studio && bootstrap) {
                  await window.studio.saveImageKey({
                    folder: bootstrap.folder,
                    connectionId: draft.id,
                    key: imageKey,
                  });
                  setImageKey('');
                  await refreshImageConnection(draft.id);
                }
                onClose();
              } catch (error) {
                demo(error instanceof Error ? error.message : 'Не удалось сохранить подключение.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <label className="field-label">
        Название
        <input
          disabled={busy || authActive}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="field-label">
        Назначение
        <Select
          label="Назначение подключения"
          value={draft.purpose}
          disabled={busy || authActive}
          options={[
            { value: 'codex', label: 'Codex — подписка' },
            { value: 'images', label: 'OpenAI Images API' },
            { value: 'pi', label: 'Провайдер Pi' },
            { value: 'compatible', label: 'Совместимый endpoint' },
            { value: 'local', label: 'Локальная модель' },
          ]}
          onValueChange={(purpose) => {
            setImageKey('');
            const value = purpose as Connection['purpose'];
            setDraft({
              ...draft,
              purpose: value,
              endpoint: value === 'compatible' || value === 'local' ? draft.endpoint : '',
              providerId:
                value === 'codex'
                  ? 'openai-codex'
                  : value === 'images'
                    ? 'openai'
                    : value === 'compatible' || value === 'local'
                      ? endpointProviderId(draft.id)
                      : '',
              authScope: value === 'images' ? undefined : 'connection',
              endpointConfig:
                value === 'compatible' || value === 'local'
                  ? (draft.endpointConfig ?? {
                      api: 'openai-completions',
                      auth: value === 'local' ? 'none' : 'api_key',
                      models: [],
                    })
                  : undefined,
            });
          }}
        />
      </label>
      {!custom && (
        <label className="field-label">
          ID провайдера
          {window.studio && draft.purpose === 'pi' ? (
            <Select
              label="Провайдер Pi"
              value={draft.providerId || 'none'}
              disabled={busy || authActive}
              options={[
                {
                  value: 'none',
                  label: loading ? 'Загружаем провайдеров…' : 'Выберите провайдера',
                },
                ...(catalog?.providers.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.id}`,
                })) ?? []),
                ...(draft.providerId &&
                !catalog?.providers.some((item) => item.id === draft.providerId)
                  ? [{ value: draft.providerId, label: draft.providerId }]
                  : []),
              ]}
              onValueChange={(id) => setDraft({ ...draft, providerId: id === 'none' ? '' : id })}
            />
          ) : (
            <input
              disabled={busy || authActive}
              value={draft.providerId}
              readOnly={draft.purpose === 'codex' || draft.purpose === 'images'}
              onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
            />
          )}
        </label>
      )}
      {draft.purpose === 'images' ? (
        <>
          <ImageKeyFields
            id={draft.id}
            name={draft.name}
            value={imageKey}
            setValue={setImageKey}
            busy={busy}
            setBusy={setBusy}
          />
          <Button
            disabled={!window.studio || !bootstrap || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await getStudioApi().checkImageConnection({
                  folder: bootstrap!.folder,
                  connectionId: draft.id,
                });
                await refreshImageConnection(draft.id);
              } catch (error) {
                await refreshImageConnection(draft.id).catch(() => {});
                demo(error instanceof Error ? error.message : 'Проверка не выполнена.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Проверить подключение
          </Button>
        </>
      ) : (
        <>
          {!custom && (
            <label className="field-label">
              Авторизация
              <Select
                label="Область авторизации Pi"
                disabled={busy || authActive}
                value={draft.authScope ?? 'native'}
                options={[
                  { value: 'connection', label: 'Отдельный вход для этого подключения' },
                  { value: 'native', label: 'Общий вход Pi' },
                ]}
                onValueChange={(value) =>
                  setDraft({ ...draft, authScope: value as 'connection' | 'native' })
                }
              />
            </label>
          )}
          {custom && (
            <EndpointFields
              connection={draft}
              update={setDraft}
              disabled={busy || authActive}
              discover={() => {
                setBusy(true);
                void (async () => {
                  try {
                    await save();
                    const ids = await getStudioApi().discoverConnectionModels({
                      folder: bootstrap!.folder,
                      connectionId: draft.id,
                    });
                    setDraft({
                      ...draft,
                      endpointConfig: {
                        ...draft.endpointConfig!,
                        models: [
                          ...draft.endpointConfig!.models,
                          ...ids
                            .filter(
                              (id) =>
                                !draft.endpointConfig!.models.some((model) => model.id === id),
                            )
                            .map((id) => ({
                              id,
                              name: id,
                              imageInput: false,
                              reasoning: false,
                              contextWindow: 4096,
                              maxTokens: 1024,
                            })),
                        ],
                      },
                    });
                  } catch (error) {
                    demo(
                      error instanceof Error
                        ? error.message
                        : 'Не удалось прочитать модели сервера.',
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          )}
          {error && <p role="alert">{error}</p>}
          <NativeConnectionAuth
            connection={draft}
            provider={provider}
            busy={busy}
            setBusy={setBusy}
            onActiveChange={setAuthActive}
            beforeAuth={save}
          />
          <Button disabled={loading || busy || authActive} onClick={() => void reload()}>
            Загрузить каталог Pi
          </Button>
        </>
      )}
      <p className="subtle">
        При отказе или исчерпании лимита подключение не меняется автоматически. Секреты не входят в
        проект и его снимки.
      </p>
    </Modal>
  );
}
