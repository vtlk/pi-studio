import { getStudioApi } from '@/shared/desktopApi';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import type { AuthLoginState } from '../../../../shared/auth';

export function ResourceAuthDialog({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<AuthLoginState>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const read = () =>
      void getStudioApi().readAuthLogin(id).then(
        (value) => {
          if (active) setState(value);
        },
        () => {
          if (active) setError('Не удалось проверить вход. Откройте окно заново.');
        },
      );
    read();
    const timer = setInterval(read, 500);
    return () => {
      active = false;
      clearInterval(timer);
      void window.studio?.cancelAuthLogin(id);
    };
  }, [id]);
  return (
    <Modal
      title={`Вход MCP · ${name}`}
      onClose={onClose}
      footer={
        <Button onClick={onClose}>
          {state && ['ready', 'error', 'cancelled'].includes(state.phase) ? 'Закрыть' : 'Отмена'}
        </Button>
      }
    >
      <p role="status">{state?.message ?? 'Открываем вход Pi…'}</p>
      {state?.prompt && (
        <>
          <p>
            Если браузер не вернулся в Pi, вставьте адрес перенаправления из адресной строки. Не
            передавайте его помощнику в чат.
          </p>
          <label className="field-label">
            Адрес возврата OAuth
            <input
              type="password"
              aria-label="Адрес возврата OAuth"
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <Button
            disabled={!answer.trim()}
            onClick={async () => {
              try {
                await getStudioApi().answerAuthLogin(id, state.prompt!.id, answer);
                setAnswer('');
              } catch {
                setError('Не удалось передать ответ. Проверьте состояние входа.');
              }
            }}
          >
            Продолжить вход
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </Modal>
  );
}
