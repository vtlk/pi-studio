import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useConfirm } from '@/shared/model/Confirm';
import { useStorage } from '@/shared/storage/Storage';
import type { Resource } from '../../../../shared/resources';
import type { McpSecretStatus } from '../../../../shared/mcpSecrets';

export function McpSecretsDialog({
  resource,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
}) {
  const { bootstrap, saveNow } = useStorage();
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<McpSecretStatus>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const folder = bootstrap?.folder;
  useEffect(() => {
    if (!folder || !window.studio) return;
    let current = true;
    void window.studio.readMcpSecretStatus({ folder, resourceId: resource.id }).then(
      (result) => {
        if (current) setStatus(result);
      },
      (error) => {
        if (current)
          setError(error instanceof Error ? error.message : 'Не удалось прочитать параметры MCP.');
      },
    );
    return () => {
      current = false;
    };
  }, [folder, resource.id]);
  const changed = Object.fromEntries(Object.entries(values).filter(([, value]) => !!value));
  const apply = async (remove = false) => {
    if (!window.studio || !status || !folder || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveNow())) throw new Error('Дождитесь сохранения настроек.');
      const request = { folder, resourceId: resource.id, revision: status.revision };
      setStatus(
        remove
          ? await window.studio.removeMcpSecrets(request)
          : await window.studio.saveMcpSecrets({ ...request, values: changed }),
      );
      setValues({});
      setMessage(
        remove
          ? 'Сохранённые значения удалены. Перед использованием введите параметры заново.'
          : 'Параметры сохранены. Проверьте подключение; агент получит их при следующем открытии Pi.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить параметры MCP.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Защищённые параметры · ${resource.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Закрыть
          </Button>
          <Button
            kind="primary"
            disabled={busy || !status?.secureStorageAvailable || !Object.keys(changed).length}
            onClick={() => void apply()}
          >
            Сохранить параметры
          </Button>
        </>
      }
    >
      <p>
        Ключи хранятся защищёнными средствами macOS вне студии и проектов. Сохранённые значения не
        показываются и не передаются помощнику. Изменения применяются при следующем открытии Pi.
        Заполните только секреты. Остальные переменные (например PATH и HOME) читает штатный Pi из
        своего окружения. Ранее сохранённые секреты всегда нужно вводить через эту форму.
      </p>
      {status && (
        <>
          <p>{status.destination}</p>
          {!status.secureStorageAvailable && (
            <p role="alert">Защищённое хранилище macOS недоступно. Сохранение ключей отключено.</p>
          )}
          {status.configurationChanged && (
            <p role="alert">
              Конфигурация сервера изменилась. Введите параметры для нового подключения; прежние
              ключи ему не передаются.
            </p>
          )}
          {status.unreadable && (
            <p role="alert">
              Сохранённые параметры не удалось прочитать. Введите их заново или удалите сохранённые
              значения.
            </p>
          )}
          {!status.fields.length && (
            <p>
              В настройках Pi нет переменных для защищённого ввода. Помощник может настроить
              HTTP-заголовки, окружение stdio или OAuth clientSecret со ссылками на параметры. Для
              OAuth используйте «Войти через Pi».
            </p>
          )}
          {status.fields.map((field) => (
            <label className="field-label" key={field.name}>
              <span>
                {field.name}
                {field.stored ? ' · сохранён' : ''}
              </span>
              <input
                type="password"
                aria-label={`Значение ${field.name}`}
                autoComplete="new-password"
                spellCheck={false}
                disabled={busy || !status.secureStorageAvailable}
                value={values[field.name] ?? ''}
                placeholder={
                  field.stored
                    ? 'Оставьте пустым, чтобы сохранить прежнее значение'
                    : 'Введите значение'
                }
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                }
              />
            </label>
          ))}
          {status.hasSavedValues && (
            <Button
              disabled={busy}
              onClick={() =>
                confirm({
                  title: 'Удалить защищённые параметры?',
                  description: `Удалить все сохранённые ключи MCP «${resource.name}» из приложения? Ключи на стороне сервиса не отзываются.`,
                  confirmLabel: 'Удалить',
                  onConfirm: () => apply(true),
                })
              }
            >
              Удалить сохранённые параметры
            </Button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </Modal>
  );
}
