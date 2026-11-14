import { getStudioApi } from '@/shared/desktopApi';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { StartupState } from '../../../shared/startup';
import { StartupScreen } from '@/shared/ui/StartupScreen';
import { Button } from '@/shared/ui';

export function StartupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StartupState>({ phase: 'checking', message: 'Проверяем Pi…' });
  const [error, setError] = useState('');
  const settled = ['ready', 'skipped', 'error'].includes(state.phase) || !!error;
  const refresh = useCallback(async () => {
    try {
      setState(await getStudioApi().getStartup());
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось проверить Pi.');
    }
  }, []);
  useEffect(() => {
    if (!window.studio || settled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 400);
    return () => clearInterval(timer);
  }, [refresh, settled]);
  if (!window.studio || state.phase === 'ready' || state.phase === 'skipped') return children;
  const failed = !!error || state.phase === 'error';
  return (
    <StartupScreen message={error || state.message} progress={state.progress} error={failed}>
      {failed && (
        <>
          <Button
            kind="primary"
            onClick={async () => {
              try {
                setError('');
                setState(await getStudioApi().retryStartup());
              } catch {
                setError('Не удалось повторить подготовку Pi.');
              }
            }}
          >
            Повторить
          </Button>
          <Button
            onClick={async () => {
              try {
                const next = await getStudioApi().chooseStartupPi();
                if (next) {
                  setError('');
                  setState(next);
                }
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Не удалось выбрать Pi.');
              }
            }}
          >
            Выбрать установленный Pi
          </Button>
        </>
      )}
      <Button
        onClick={async () => {
          try {
            setError('');
            setState(await getStudioApi().skipStartup());
          } catch {
            setError('Не удалось открыть студию. Повторите попытку.');
          }
        }}
      >
        Открыть без Pi
      </Button>
    </StartupScreen>
  );
}
