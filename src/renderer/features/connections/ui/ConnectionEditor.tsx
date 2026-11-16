import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { useNotice } from '@/shared/model/Notice';
import { useConnections, type Connection } from '../model/Connections';
import { usePiCatalog } from '../model/usePiCatalog';
import { useStorage } from '@/shared/storage/Storage';
import { ImageKeyFields } from './ImageKeyFields';
import { NativeConnectionAuth } from './NativeConnectionAuth';
import { ClaudeCodeAuth } from './ClaudeCodeAuth';
import { EndpointFields } from './EndpointFields';
import { endpointProviderId } from '../../../../shared/modelEndpoint';

export function ConnectionEditor({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
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
  const claudeCode = draft.providerId === 'claude-code';
  const provider = custom
    ? {
        id: draft.providerId,
        name: draft.name,
        configured: false,
        subscription: false,
        isolatedAuth: true,
        loginMethods:
          draft.endpointConfig?.auth === 'api_key'
            ? [{ id: 'api_key' as const, label: t('ConnectionEditor.apiKey') }]
            : [],
      }
    : catalog?.providers.find((item) => item.id === draft.providerId);
  const save = async () => {
    if (!draft.name.trim() || !draft.providerId.trim())
      throw new Error(t('ConnectionEditor.enterAConnectionNameAndProvider'));
    saveConnection(claudeCode ? { ...draft, authScope: 'native' } : draft);
    if (!(await saveNow())) throw new Error(t('ConnectionEditor.saveConnectionSettingsFirst'));
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      title={connection.name || t('ConnectionEditor.addConnection')}
      onClose={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('TeamNameDialog.cancel')}
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
                demo(
                  error instanceof Error
                    ? error.message
                    : t('ConnectionEditor.couldNotSaveTheConnection'),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('TeamNameDialog.save')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('ConnectionEditor.name')}
        <input
          disabled={busy || authActive}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="field-label">
        {t('ConnectionEditor.purpose')}
        <Select
          label={t('ConnectionEditor.connectionPurpose')}
          value={draft.purpose}
          disabled={busy || authActive}
          options={[
            { value: 'codex', label: t('ConnectionEditor.codexSubscription') },
            { value: 'images', label: 'OpenAI Images API' },
            { value: 'pi', label: t('ConnectionEditor.piProvider') },
            { value: 'compatible', label: t('ConnectionEditor.compatibleEndpoint') },
            { value: 'local', label: t('ConnectionEditor.localModel') },
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
          {t('ConnectionEditor.providerId')}
          {window.studio && draft.purpose === 'pi' ? (
            <SearchableSelect
              label={t('ConnectionEditor.providerId')}
              placeholder={t('ConnectionEditor.selectAProvider')}
              searchPlaceholder={t('ConnectionEditor.searchProviders')}
              emptyMessage={t('ConnectionEditor.noProvidersFound')}
              loadingMessage={t('ConnectionEditor.loadingProviders')}
              loading={loading}
              value={draft.providerId || 'none'}
              disabled={busy || authActive}
              options={[
                ...(catalog?.providers.length
                  ? [{ value: 'none', label: t('ConnectionEditor.selectAProvider') }]
                  : []),
                ...(catalog?.providers.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.id}`,
                })) ?? []),
                ...(draft.providerId &&
                !catalog?.providers.some((item) => item.id === draft.providerId)
                  ? [
                      {
                        value: draft.providerId,
                        label: t('ModelPanel.unavailable', { value1: draft.providerId }),
                        disabled: true,
                      },
                    ]
                  : []),
              ]}
              onValueChange={(id) =>
                setDraft({
                  ...draft,
                  providerId: id === 'none' ? '' : id,
                  authScope: id === 'claude-code' ? 'native' : draft.authScope,
                })
              }
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
                demo(
                  error instanceof Error ? error.message : t('ConnectionEditor.checkNotPerformed'),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('ClaudeCodeAuth.checkConnection')}
          </Button>
        </>
      ) : (
        <>
          {!custom && (
            <label className="field-label">
              {t('ConnectionEditor.authentication')}
              <Select
                label={t('ConnectionEditor.piAuthenticationScope')}
                disabled={busy || authActive || claudeCode}
                value={claudeCode ? 'native' : (draft.authScope ?? 'native')}
                options={
                  claudeCode
                    ? [{ value: 'native', label: t('ConnectionEditor.sharedClaudeCodeCliLogin') }]
                    : [
                        {
                          value: 'connection',
                          label: t('ConnectionEditor.separateLoginForThisConnection'),
                        },
                        { value: 'native', label: t('ConnectionEditor.sharedPiLogin') },
                      ]
                }
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
                        : t('ConnectionEditor.couldNotReadTheServerSModels'),
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          )}
          {error && <p role="alert">{error}</p>}
          {claudeCode ? (
            <ClaudeCodeAuth
              connectionId={draft.id}
              busy={busy}
              setBusy={setBusy}
              beforeAuth={save}
            />
          ) : (
            <NativeConnectionAuth
              connection={draft}
              provider={provider}
              busy={busy}
              setBusy={setBusy}
              onActiveChange={setAuthActive}
              beforeAuth={save}
            />
          )}
          <Button disabled={loading || busy || authActive} onClick={() => void reload()}>
            {t('ConnectionEditor.loadPiCatalog')}
          </Button>
        </>
      )}
      <p className="subtle">
        {t('ConnectionEditor.theConnectionNeverSwitchesAutomaticallyAfterA')}
      </p>
    </Modal>
  );
}
