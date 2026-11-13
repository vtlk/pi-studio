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
  const { bootstrap } = useStorage();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const { connections, providerStatuses, setProviderStatus } = useConnections();
  const [auth, setAuth] = useState<AuthLoginState>();
  const [answer, setAnswer] = useState('');
  const [method, setMethod] = useState<'oauth' | 'api_key'>('oauth');
  const methods = provider?.loginMethods ?? [];
  const selectedMethod = methods.find((item) => item.id === method)?.id ?? methods[0]?.id;
  const active = !!auth && ['opening', 'waiting', 'verifying'].includes(auth.phase);
  const saved = connections.find((item) => item.id === connection.id);
  const matches =
    saved?.providerId === connection.providerId &&
    saved?.authScope === connection.authScope &&
    saved?.purpose === connection.purpose;
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
      void window.studio!.readAuthLogin(id).then(
        (next) => {
          if (!current) return;
          setAuth(next);
          if (next.phase === 'ready' && bootstrap) {
            void window
              .studio!.getConnectionStatus({
                folder: bootstrap.folder,
                connectionId: connection.id,
              })
              .then(setProviderStatus, () => {});
          }
        },
        () => {
          if (current)
            setAuth({ id, phase: 'error', message: 'Не удалось проверить состояние входа.' });
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
      demo(error instanceof Error ? error.message : 'Не удалось настроить подключение.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {connection.purpose === 'codex' && <p>Вход через ChatGPT · лимиты подписки</p>}
      {methods.length > 1 && (
        <label className="field-label">
          Способ входа
          <Select
            label="Способ входа Pi"
            value={selectedMethod!}
            disabled={busy || active}
            options={methods.map((item) => ({ value: item.id, label: item.label }))}
            onValueChange={(id) => setMethod(id as 'oauth' | 'api_key')}
          />
        </label>
      )}
      {!isolatedSupported && (
        <p role="status">
          Для этого провайдера требуется конфигурация Pi. Отдельный вход пока недоступен; общий вход
          Pi выбирается явно.
        </p>
      )}
      {methods.length === 0 && (
        <p className="subtle">
          У этого провайдера нет формы входа. Используйте его штатное окружение или конфигурацию Pi
          и проверьте подключение.
        </p>
      )}
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
              await window.studio!.beginConnectionLogin({ ...request!, method: selectedMethod! }),
            );
          })
        }
      >
        {connection.purpose === 'codex' ? 'Войти через ChatGPT' : 'Войти через Pi'}
      </Button>
      <p className="subtle">
        Перед входом запись подключения сохраняется. Авторизацию и обновление токенов выполняет Pi.
      </p>
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
          {auth.prompt.message ?? 'Ответ для входа Pi'}
          {auth.prompt.options ? (
            <Select
              label="Ответ для входа Pi"
              value={answer || 'none'}
              options={[
                { value: 'none', label: 'Выберите вариант' },
                ...auth.prompt.options.map((item) => ({ value: item.id, label: item.label })),
              ]}
              onValueChange={(value) => setAnswer(value === 'none' ? '' : value)}
            />
          ) : (
            <input
              aria-label="Ответ для входа Pi"
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
                await window.studio!.answerAuthLogin(auth.id, auth.prompt!.id, answer);
                setAnswer('');
              } catch {
                setAuth({
                  id: auth.id,
                  phase: 'error',
                  message: 'Ответ не принят. Повторите вход.',
                });
              }
            }}
          >
            Продолжить вход
          </Button>
        </label>
      )}
      {active && auth && (
        <Button onClick={() => void window.studio?.cancelAuthLogin(auth.id)}>Отменить вход</Button>
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
              setProviderStatus(await window.studio!.getConnectionStatus(request!));
            })
          }
        >
          Проверить подключение
        </Button>
        <Button
          disabled={!window.studio || !request || busy || active || !matches}
          onClick={() =>
            confirm({
              title: 'Удалить сохранённый вход?',
              description:
                connection.authScope === 'connection'
                  ? 'Pi удалит локальную авторизацию только этого подключения. Проекты и диалоги сохранятся. Это не отзыв доступа на стороне сервиса.'
                  : 'Удалится общий вход этого провайдера в Pi. Другие подключения с общим входом тоже потребуют авторизацию. Проекты и диалоги сохранятся.',
              onConfirm: () =>
                void perform(async () => {
                  await window.studio!.removeConnectionLogin(request!);
                  setProviderStatus(await window.studio!.getConnectionStatus(request!));
                }),
            })
          }
        >
          Удалить сохранённый вход
        </Button>
      </div>
      <p role="status">
        {status === 'ready'
          ? 'Подключено через Pi.'
          : status === 'not_ready'
            ? 'Pi: требуется вход.'
            : status === 'invalid'
              ? 'Pi: ошибка авторизации.'
              : status === 'checking'
                ? 'Проверяем подключение…'
                : status === 'unavailable'
                  ? 'Не удалось проверить подключение.'
                  : 'Авторизация ещё не проверена.'}
      </p>
    </>
  );
}
