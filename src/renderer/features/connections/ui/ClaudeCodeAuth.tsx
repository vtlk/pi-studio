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
        demo('Завершите действие в Terminal и нажмите «Проверить подключение».');
      } else await check();
    } catch (error) {
      demo(error instanceof Error ? error.message : 'Не удалось проверить Claude Code.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Общий вход официального Claude Code CLI. Он используется всеми подключениями Claude Code на
        этом Mac.
      </p>
      <p role="status">
        {status?.status === 'ready'
          ? 'Подключено через Claude Code.'
          : (status?.detail ?? 'Сохраните подключение и проверьте Claude Code.')}
      </p>
      {status?.status === 'ready' && <p className="subtle">{status.detail}</p>}
      <div className="action-row">
        <Button kind="primary" disabled={busy || !folder} onClick={() => void perform('login')}>
          Войти через Claude Code
        </Button>
        <Button disabled={busy || !folder} onClick={() => void perform()}>
          Проверить подключение
        </Button>
        <Button disabled={busy || !folder} onClick={() => void perform('install')}>
          Установить Claude Code
        </Button>
        <Button
          disabled={busy || !folder}
          onClick={() =>
            confirm({
              title: 'Выйти из общего аккаунта Claude Code?',
              description:
                'Штатный выход CLI затронет все подключения Claude Code на этом Mac. Проекты и диалоги сохранятся.',
              onConfirm: () => void perform('logout'),
            })
          }
        >
          Выйти из Claude Code
        </Button>
      </div>
    </>
  );
}
