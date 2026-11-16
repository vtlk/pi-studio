import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { StartupState } from '../../../shared/startup';
import { StartupScreen } from '@/shared/ui/StartupScreen';
import { Button } from '@/shared/ui';

export function StartupGate({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const [state, setState] = useState<StartupState>({
    phase: 'checking',
    message: t('StartupGate.checkingPi'),
  });
  const [error, setError] = useState('');
  const settled = ['ready', 'skipped', 'error'].includes(state.phase) || !!error;
  const refresh = useCallback(async () => {
    try {
      setState(await getStudioApi().getStartup());
    } catch (error) {
      setError(error instanceof Error ? error.message : t('StartupGate.couldNotCheckPi'));
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
                setError(t('StartupGate.couldNotRetryPiPreparation'));
              }
            }}
          >
            {t('StartupGate.retry')}
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
                setError(
                  error instanceof Error ? error.message : t('StartupGate.couldNotSelectPi'),
                );
              }
            }}
          >
            {t('StartupGate.chooseInstalledPi')}
          </Button>
        </>
      )}
      <Button
        onClick={async () => {
          try {
            setError('');
            setState(await getStudioApi().skipStartup());
          } catch {
            setError(t('StartupGate.couldNotOpenTheStudioTryAgain'));
          }
        }}
      >
        {t('StartupGate.openWithoutPi')}
      </Button>
    </StartupScreen>
  );
}
