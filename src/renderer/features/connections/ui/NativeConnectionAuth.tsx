import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';
import type { AuthLoginState } from '../../../../shared/auth';
import type { Connection } from '../../../../shared/connections';
import type { PiProviderSummary } from '../../../../shared/models';
import { useConnections } from '../model/Connections';

export function NativeConnectionAuth({
  connection,
  provider,
  busy,
  setBusy,
  onActiveChange,
  beforeAuth,
}: {
  connection: Connection;
  provider?: PiProviderSummary;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onActiveChange: (value: boolean) => void;
  beforeAuth: () => Promise<void>;
}) {
  useTranslation(undefined, { i18n });
  const { bootstrap } = useStorage();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const { connections, providerStatuses, setProviderStatus } = useConnections();
  const [auth, setAuth] = useState<AuthLoginState>();
  const [answer, setAnswer] = useState('');
  const [method, setMethod] = useState<'oauth' | 'api_key'>('oauth');
  const methods = (provider?.loginMethods ?? []).map((method) => ({
    ...method,
    label: method.id === 'api_key' ? t('ConnectionEditor.apiKey') : t('auth.oauth'),
  }));
  const keyless = connection.endpointConfig?.auth === 'none';
  const selectedMethod = methods.find((item) => item.id === method)?.id ?? methods[0]?.id;
  const active = !!auth && ['opening', 'waiting', 'verifying'].includes(auth.phase);
  const saved = connections.find((item) => item.id === connection.id);
  const matches =
    saved?.providerId === connection.providerId &&
    saved?.authScope === connection.authScope &&
    saved?.purpose === connection.purpose &&
    saved?.endpoint === connection.endpoint &&
    JSON.stringify(saved?.endpointConfig) === JSON.stringify(connection.endpointConfig);
  const status = matches ? providerStatuses[connection.id] : undefined;
  const request = bootstrap && { folder: bootstrap.folder, connectionId: connection.id };
  const isolatedSupported =
    connection.authScope !== 'connection' || provider?.isolatedAuth === true;
  useEffect(() => {
    onActiveChange(active);
    return () => onActiveChange(false);
  }, [active, onActiveChange]);
  useEffect(() => {
    if (!auth?.id || !active) return;
    const id = auth.id;
    let current = true;
    const timer = setInterval(() => {
      void getStudioApi()
        .readAuthLogin(id)
        .then(
          (next) => {
            if (!current) return;
            setAuth(next);
            if (next.phase === 'ready' && bootstrap) {
              void getStudioApi()
                .getConnectionStatus({
                  folder: bootstrap.folder,
                  connectionId: connection.id,
                })
                .then(setProviderStatus, () => {});
            }
          },
          () => {
            if (current)
              setAuth({
                id,
                phase: 'error',
                message: t('NativeConnectionAuth.couldNotCheckSignInStatus'),
              });
          },
        );
    }, 500);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [auth?.id, active, bootstrap, connection.id, setProviderStatus]);
  useEffect(() => {
    const id = auth?.id;
    return () => {
      if (id) void window.studio?.cancelAuthLogin(id);
    };
  }, [auth?.id]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await beforeAuth();
      await action();
    } catch (error) {
      demo(
        error instanceof Error
          ? error.message
          : uiText('NativeConnectionAuth.couldNotConfigureTheConnection'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {connection.purpose === 'codex' && (
        <p>{t('NativeConnectionAuth.signInThroughChatgptSubscriptionLimits')}</p>
      )}
      {methods.length > 1 && (
        <label className="field-label">
          {t('NativeConnectionAuth.signInMethod')}
          <Select
            label={t('NativeConnectionAuth.piSignInMethod')}
            value={selectedMethod!}
            disabled={busy || active}
            options={methods.map((item) => ({ value: item.id, label: item.label }))}
            onValueChange={(id) => setMethod(id as 'oauth' | 'api_key')}
          />
        </label>
      )}
      {!isolatedSupported && (
        <p role="status">
          {t('NativeConnectionAuth.thisProviderRequiresPiConfigurationSeparateSign')}
        </p>
      )}
      {methods.length === 0 && (
        <p className="subtle">
          {keyless
            ? t('NativeConnectionAuth.theServerUsesNoAuthenticationKeysFrom')
            : t('NativeConnectionAuth.thisProviderHasNoSignInForm')}
        </p>
      )}
      {!keyless && (
        <Button
          kind="primary"
          disabled={
            !window.studio ||
            !request ||
            !selectedMethod ||
            !isolatedSupported ||
            busy ||
            active ||
            !connection.name.trim()
          }
          onClick={() =>
            void perform(async () => {
              setAnswer('');
              setAuth(
                await getStudioApi().beginConnectionLogin({ ...request!, method: selectedMethod! }),
              );
            })
          }
        >
          {connection.purpose === 'codex'
            ? t('NativeConnectionAuth.signInThroughChatgpt')
            : t('NativeConnectionAuth.signInThroughPi')}
        </Button>
      )}
      {!keyless && (
        <p className="subtle">{t('NativeConnectionAuth.theConnectionRecordIsSavedBeforeSign')}</p>
      )}
      {auth && (
        <p
          role={auth.phase === 'error' ? 'alert' : 'status'}
          className={auth.phase === 'error' ? 'error-message' : ''}
        >
          {auth.message}
        </p>
      )}
      {auth?.prompt && (
        <label className="field-label">
          {auth.prompt.message ?? t('NativeConnectionAuth.piSignInResponse')}
          {auth.prompt.options ? (
            <Select
              label={t('NativeConnectionAuth.piSignInResponse')}
              value={answer || 'none'}
              options={[
                { value: 'none', label: t('NativeConnectionAuth.selectAnOption') },
                ...auth.prompt.options.map((item) => ({ value: item.id, label: item.label })),
              ]}
              onValueChange={(value) => setAnswer(value === 'none' ? '' : value)}
            />
          ) : (
            <input
              aria-label={t('NativeConnectionAuth.piSignInResponse')}
              type={auth.prompt.secret ? 'password' : 'text'}
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          <Button
            disabled={!answer.trim()}
            onClick={async () => {
              try {
                await getStudioApi().answerAuthLogin(auth.id, auth.prompt!.id, answer);
                setAnswer('');
              } catch {
                setAuth({
                  id: auth.id,
                  phase: 'error',
                  message: t('NativeConnectionAuth.responseRejectedSignInAgain'),
                });
              }
            }}
          >
            {t('NativeConnectionAuth.continueSignIn')}
          </Button>
        </label>
      )}
      {active && auth && (
        <Button onClick={() => void window.studio?.cancelAuthLogin(auth.id)}>
          {t('NativeConnectionAuth.cancelSignIn')}
        </Button>
      )}
      <div className="action-row">
        <Button
          disabled={
            !window.studio ||
            !request ||
            busy ||
            active ||
            !connection.name.trim() ||
            !connection.providerId.trim()
          }
          onClick={() =>
            void perform(async () => {
              setProviderStatus(await getStudioApi().getConnectionStatus(request!));
            })
          }
        >
          {t('ClaudeCodeAuth.checkConnection')}
        </Button>
        {!keyless && (
          <Button
            disabled={!window.studio || !request || busy || active || !matches}
            onClick={() =>
              confirm({
                title: uiText('NativeConnectionAuth.deleteTheSavedLoginForConnection', {
                  value1: connection.name.trim() || connection.id,
                }),
                description:
                  connection.authScope === 'connection'
                    ? uiText('NativeConnectionAuth.piWillRemoveLocalAuthenticationForThis')
                    : uiText('NativeConnectionAuth.theSharedPiLoginForThisProvider'),
                onConfirm: () =>
                  void perform(async () => {
                    await getStudioApi().removeConnectionLogin(request!);
                    setProviderStatus(await getStudioApi().getConnectionStatus(request!));
                  }),
              })
            }
          >
            {t('NativeConnectionAuth.deleteSavedLogin')}
          </Button>
        )}
      </div>
      <p role="status">
        {status === 'ready'
          ? t('NativeConnectionAuth.connectedThroughPi')
          : status === 'not_ready'
            ? t('NativeConnectionAuth.piSignInRequired')
            : status === 'invalid'
              ? t('NativeConnectionAuth.piAuthenticationError')
              : status === 'checking'
                ? t('ConnectionsPanel.checkingConnection')
                : status === 'unavailable'
                  ? t('NativeConnectionAuth.couldNotCheckTheConnection')
                  : t('NativeConnectionAuth.authenticationHasNotBeenChecked')}
      </p>
    </>
  );
}
