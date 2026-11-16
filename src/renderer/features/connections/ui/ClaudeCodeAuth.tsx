import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';
import { useConnections } from '../model/Connections';
import type { ModelConnectionStatus } from '../../../../shared/connections';

export function ClaudeCodeAuth({
  connectionId,
  busy,
  setBusy,
  beforeAuth,
}: {
  connectionId: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  beforeAuth: () => Promise<void>;
}) {
  useTranslation(undefined, { i18n });
  const { bootstrap } = useStorage();
  const { setProviderStatus } = useConnections();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const [status, setStatus] = useState<ModelConnectionStatus>();
  const folder = bootstrap?.folder;
  const check = useCallback(async () => {
    if (!window.studio || !folder) return;
    const next = await getStudioApi().getConnectionStatus({ folder, connectionId });
    setStatus(next);
    setProviderStatus(next);
  }, [folder, connectionId, setProviderStatus]);
  useEffect(() => {
    const refresh = () => {
      void check().catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [check]);
  const perform = async (action?: 'install' | 'login' | 'logout') => {
    setBusy(true);
    try {
      await beforeAuth();
      if (action && folder) {
        await getStudioApi().manageClaudeCode({ folder, connectionId, action });
        demo(t('ClaudeCodeAuth.finishTheActionInTerminalAndClick'));
      } else await check();
    } catch (error) {
      demo(error instanceof Error ? error.message : t('ClaudeCodeAuth.couldNotCheckClaudeCode'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>{t('ClaudeCodeAuth.sharedLoginThroughTheOfficialClaudeCode')}</p>
      <p role="status">
        {status?.status === 'ready'
          ? t('ClaudeCodeAuth.connectedThroughClaudeCode')
          : (status?.detail ?? t('ClaudeCodeAuth.saveTheConnectionAndCheckClaudeCode'))}
      </p>
      {status?.status === 'ready' && <p className="subtle">{status.detail}</p>}
      <div className="action-row">
        <Button kind="primary" disabled={busy || !folder} onClick={() => void perform('login')}>
          {t('ClaudeCodeAuth.signInThroughClaudeCode')}
        </Button>
        <Button disabled={busy || !folder} onClick={() => void perform()}>
          {t('ClaudeCodeAuth.checkConnection')}
        </Button>
        <Button disabled={busy || !folder} onClick={() => void perform('install')}>
          {t('ClaudeCodeAuth.installClaudeCode')}
        </Button>
        <Button
          disabled={busy || !folder}
          onClick={() =>
            confirm({
              title: t('ClaudeCodeAuth.signOutOfTheSharedClaudeCode'),
              description: t('ClaudeCodeAuth.theCliSignOutAffectsAllClaude'),
              onConfirm: () => void perform('logout'),
            })
          }
        >
          {t('ClaudeCodeAuth.signOutOfClaudeCode')}
        </Button>
      </div>
    </>
  );
}
