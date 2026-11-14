import { useCallback, useEffect, useRef, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import type { ComputerState } from '../../../../shared/computer';

export function ComputerResourceStatus() {
  const [state, setState] = useState<ComputerState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restart, setRestart] = useState(false);
  const revision = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    if (!window.studio) return;
    const counter = revision.current;
    const request = ++counter.value;
    try {
      const next = await getStudioApi().getComputerState();
      if (request === counter.value) {
        setState(next);
        setError('');
      }
    } catch {
      if (request === counter.value) setError('Не удалось проверить разрешения macOS.');
    }
  }, []);
  useEffect(() => {
    const counter = revision.current;
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      ++counter.value;
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const action = async (kind?: 'accessibility' | 'screen-recording') => {
    setBusy(true);
    try {
      if (kind) await getStudioApi().openComputerSettings(kind);
      else await getStudioApi().requestComputerPermissions();
      setRestart(true);
      await refresh();
    } catch {
      setError('Не удалось открыть разрешения macOS.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-native-actions" data-computer-status>
      <p className="subtle" role="status">
        {error ||
          state?.message ||
          (!window.studio
            ? 'Разрешения доступны в приложении macOS.'
            : state?.phase === 'ready'
              ? 'Разрешения macOS получены.'
              : state
                ? 'Для управления компьютером разрешите доступ Pi Studio в macOS.'
                : 'Проверяем разрешения…')}
      </p>
      {state?.permissions && (
        <p className="subtle">
          Универсальный доступ: {state.permissions.accessibility ? 'разрешён' : 'не разрешён'}.{' '}
          Запись экрана: {state.permissions.screenRecording ? 'разрешена' : 'не разрешена'}.
        </p>
      )}
      {window.studio && state?.phase === 'permissions_required' && (
        <div className="action-row">
          <Button
            kind="primary"
            disabled={busy}
            onClick={() => {
              void action();
            }}
          >
            Разрешить доступ
          </Button>
          {!state.permissions?.accessibility && (
            <Button
              disabled={busy}
              onClick={() => {
                void action('accessibility');
              }}
            >
              Универсальный доступ
            </Button>
          )}
          {!state.permissions?.screenRecording && (
            <Button
              disabled={busy}
              onClick={() => {
                void action('screen-recording');
              }}
            >
              Запись экрана
            </Button>
          )}
        </div>
      )}
      {restart && (
        <p className="subtle">
          После изменения разрешений сохраните работу и перезапустите Pi Studio.
        </p>
      )}
      {window.studio && (
        <div className="action-row">
          <Button
            disabled={busy}
            onClick={() => {
              void refresh();
            }}
          >
            Проверить разрешения
          </Button>
        </div>
      )}
    </div>
  );
}
