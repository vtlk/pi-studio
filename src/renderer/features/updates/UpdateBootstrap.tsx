import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { UpdateState } from '../../../shared/updates';
import { StartupScreen } from '@/shared/ui/StartupScreen';
import { Button } from '@/shared/ui';

/** Read the native startup lock before any editable application frame is mounted. */
export function UpdateBootstrap({ children }: { children: (initial?: UpdateState) => ReactNode }) {
  const [initial, setInitial] = useState<UpdateState>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!window.studio) return;
    try {
      setInitial(await window.studio.getUpdateState());
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось проверить запуск Studio.');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!window.studio) return children();
  const cancellationFailed = initial?.phase === 'error' && !!initial.prepareToken;
  if (!initial || cancellationFailed)
    return (
      <StartupScreen
        error={!!error || cancellationFailed}
        message={error || initial?.message || 'Открываем Pi Studio…'}
      >
        {(!!error || cancellationFailed) && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (cancellationFailed) await window.studio!.requestUpdate();
                await refresh();
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : 'Не удалось повторить завершение.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Повторить
          </Button>
        )}
      </StartupScreen>
    );
  return children(initial);
}
