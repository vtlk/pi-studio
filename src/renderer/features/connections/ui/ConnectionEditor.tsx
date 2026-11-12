import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
import { useConnections, type Connection } from '../model/Connections';
import type { ProviderStatus } from '../../../../shared/contracts';
import type { AuthLoginState } from '../../../../shared/auth';
export function ConnectionEditor({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(connection);
  const { saveConnection, setProviderStatus } = useConnections();
  const { demo } = useNotice();
  const [status, setStatus] = useState<ProviderStatus>();
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<AuthLoginState>();
  const [answer, setAnswer] = useState('');
  const authActive = !!auth && ['opening', 'waiting', 'verifying'].includes(auth.phase);
  useEffect(() => {
    if (!auth?.id || !authActive) return;
    const id = auth.id;
    let active = true;
    const timer = setInterval(() => {
      void window.studio!.readAuthLogin(id).then(
        (next) => {
          if (!active) return;
          setAuth(next);
          if (next.phase === 'ready') {
            const result: ProviderStatus = { provider: 'openai-codex', status: 'ready' };
            setStatus(result);
            setProviderStatus(result);
          }
        },
        () => {
          if (active)
            setAuth({ id, phase: 'error', message: 'Не удалось проверить состояние входа.' });
        },
      );
    }, 500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [auth?.id, authActive, setProviderStatus]);
  useEffect(() => {
    const id = auth?.id;
    return () => {
      if (id) void window.studio?.cancelAuthLogin(id);
    };
  }, [auth?.id]);
  const close = () => {
    if (authActive && auth) void window.studio?.cancelAuthLogin(auth.id);
    onClose();
  };
  const login = async () => {
    if (!window.studio) {
      demo('Вход Pi доступен в приложении macOS.');
      return;
    }
    setBusy(true);
    try {
      if (draft.purpose === 'codex') {
        setAuth(await window.studio.beginCodexLogin());
        return;
      }
      await window.studio.openProviderLogin(draft.providerId);
      demo('Открыт штатный вход Pi в Terminal. Завершите вход там и проверьте подключение.');
    } catch (error) {
      demo(error instanceof Error ? error.message : 'Не удалось открыть вход Pi.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={connection.name || 'Добавить подключение'}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button
            kind="primary"
            disabled={authActive || busy || !draft.name.trim() || !draft.providerId.trim()}
            onClick={() => {
              saveConnection(draft);
              onClose();
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
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="field-label">
        Назначение
        <Select
          label="Назначение подключения"
          value={draft.purpose}
          onValueChange={(purpose) => {
            const value = purpose as Connection['purpose'];
            setDraft({
              ...draft,
              purpose: value,
              providerId: value === 'codex' ? 'openai-codex' : value === 'images' ? 'openai' : '',
            });
          }}
          options={[
            { value: 'codex', label: 'Codex — подписка' },
            { value: 'images', label: 'OpenAI Images API' },
            { value: 'pi', label: 'Провайдер Pi' },
            { value: 'compatible', label: 'Совместимый endpoint' },
            { value: 'local', label: 'Локальная модель' },
          ]}
        />
      </label>
      <label className="field-label">
        ID провайдера
        <input
          value={draft.providerId}
          onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
          readOnly={draft.purpose === 'codex' || draft.purpose === 'images'}
        />
      </label>
      {draft.purpose === 'codex' ? (
        <>
          <p>Вход через ChatGPT · лимиты подписки</p>
          <Button kind="primary" disabled={busy || authActive} onClick={() => void login()}>
            Войти через ChatGPT
          </Button>
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
              Ответ браузера
              <input
                type={auth.prompt.secret ? 'password' : 'text'}
                autoComplete="off"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Адрес возврата или код из окна входа"
              />
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
          {authActive && auth && (
            <Button onClick={() => void window.studio!.cancelAuthLogin(auth.id)}>
              Отменить вход
            </Button>
          )}
        </>
      ) : draft.purpose === 'images' ? (
        <>
          <p>API оплачивается отдельно от подписки.</p>
          <label className="field-label">
            API-ключ
            <input
              type="password"
              disabled
              placeholder="Ввод ключа будет доступен после подключения защищённого хранилища"
            />
          </label>
          <Button
            onClick={() =>
              demo(
                'Сохранение и замена секретов пока не подключены. В прототипе ключи не вводятся.',
              )
            }
          >
            Заменить ключ
          </Button>
        </>
      ) : (
        <>
          {(draft.purpose === 'local' || draft.purpose === 'compatible') && (
            <label className="field-label">
              Адрес endpoint
              <input
                value={draft.endpoint}
                onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
                placeholder="http://localhost:…"
              />
            </label>
          )}
          <p className="prototype-note">
            Методы входа, device flow, облачные профили и параметры будут получены из реестра
            выбранной версии Pi. Реестр пока не подключён; неподтверждённые методы не предлагаются.
          </p>
          <Button
            onClick={() =>
              demo(
                'Реестр провайдеров Pi ещё не подключён. Должны загружаться все провайдеры, включая установленные расширения.',
              )
            }
          >
            Загрузить каталог Pi
          </Button>
          {window.studio && (
            <Button disabled={busy || !draft.providerId.trim()} onClick={() => void login()}>
              Войти через Pi
            </Button>
          )}
        </>
      )}
      <div className="action-row">
        <Button
          disabled={
            busy ||
            !draft.providerId.trim() ||
            draft.purpose === 'images' ||
            draft.purpose === 'compatible' ||
            draft.purpose === 'local'
          }
          onClick={async () => {
            if (!window.studio) {
              demo('Проверка доступна в приложении macOS.');
              return;
            }
            setBusy(true);
            setStatus(undefined);
            try {
              const result = await window.studio.getProviderStatus(draft.providerId);
              setStatus(result);
              setProviderStatus(result);
            } catch (error) {
              demo(error instanceof Error ? error.message : 'Проверка не выполнена.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Проверить подключение
        </Button>
      </div>
      <p role="status">
        {status
          ? status.status === 'ready'
            ? `Pi: авторизация ${status.provider} доступна. Проверка генерации не выполнялась.`
            : status.status === 'invalid'
              ? 'Pi: некорректная авторизация или провайдер.'
              : 'Pi: требуется вход или обновление авторизации.'
          : 'Авторизация ещё не проверена. Сохранение формы не подтверждает доступ аккаунта.'}
      </p>
      <p className="subtle">
        При отказе или исчерпании лимита подключение не меняется автоматически. Секреты не входят в
        проект и его снимки.
      </p>
    </Modal>
  );
}
