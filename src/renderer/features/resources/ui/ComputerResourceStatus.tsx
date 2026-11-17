import { t, i18n, type MessageKey } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import type { ComputerState } from '../../../../shared/computer';

export function ComputerResourceStatus() {
  useTranslation(undefined, { i18n });
  const mac = !navigator.platform.startsWith('Win');
  const [state, setState] = useState<ComputerState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();
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
        setError(undefined);
      }
    } catch {
      if (request === counter.value) setError('ComputerResourceStatus.checkUnavailable');
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
      setError('ComputerResourceStatus.couldNotOpenSystemPermissions');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-native-actions" data-computer-status>
      <p className="subtle" role="status">
        {(error && t(error)) ||
          (state?.phase === 'unavailable' &&
            t(
              state.reason === 'check'
                ? 'ComputerResourceStatus.checkUnavailable'
                : 'ComputerResourceStatus.componentUnavailable',
            )) ||
          (!window.studio
            ? t('ComputerResourceStatus.permissionsAreAvailableInTheDesktopApp')
            : state?.phase === 'ready'
              ? t('ComputerResourceStatus.computerControlAccessConfirmed')
              : state
                ? mac
                  ? t('ComputerResourceStatus.allowPiStudioAccessInMacosTo')
                  : t('ComputerResourceStatus.windowsAccessRequired')
                : t('ComputerResourceStatus.checkingPermissions'))}
      </p>
      {mac && state?.permissions && (
        <p className="subtle">
          {t('ComputerResourceStatus.accessibility')}
          {state.permissions.accessibility
            ? t('ComputerResourceStatus.allowed')
            : t('ComputerResourceStatus.notAllowed')}
          . {t('ComputerResourceStatus.screenRecording')}
          {state.permissions.screenRecording
            ? t('ComputerResourceStatus.allowed2')
            : t('ComputerResourceStatus.notAllowed2')}
          .
        </p>
      )}
      {mac && window.studio && state?.phase === 'permissions_required' && (
        <div className="action-row">
          <Button
            kind="primary"
            disabled={busy}
            onClick={() => {
              void action();
            }}
          >
            {t('ComputerResourceStatus.allowAccess')}
          </Button>
          {!state.permissions?.accessibility && (
            <Button
              disabled={busy}
              onClick={() => {
                void action('accessibility');
              }}
            >
              {t('ComputerResourceStatus.accessibility2')}
            </Button>
          )}
          {!state.permissions?.screenRecording && (
            <Button
              disabled={busy}
              onClick={() => {
                void action('screen-recording');
              }}
            >
              {t('ComputerResourceStatus.screenRecording2')}
            </Button>
          )}
        </div>
      )}
      {restart && (
        <p className="subtle">
          {t('ComputerResourceStatus.afterChangingPermissionsSaveYourWorkAnd')}
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
            {t('ComputerResourceStatus.checkPermissions')}
          </Button>
        </div>
      )}
    </div>
  );
}
