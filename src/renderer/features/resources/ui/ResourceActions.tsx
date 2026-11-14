import { getStudioApi } from '@/shared/desktopApi';
import { useState } from 'react';
import type { Resource } from '../../../../shared/resources';
import { useStorage } from '@/shared/storage/Storage';
import { Button } from '@/shared/ui';
import { McpSecretsDialog } from './McpSecretsDialog';
import { ResourceAuthDialog } from './ResourceAuthDialog';

export function ResourceActions({ resource }: { resource: Resource }) {
  const { saveNow } = useStorage();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [loginId, setLoginId] = useState<string>();
  if (!window.studio) return null;
  const action = async (kind: 'check' | 'install' | 'login') => {
    if (busy) return;
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      if (!(await saveNow())) throw new Error('Дождитесь сохранения настроек.');
      if (kind === 'login') {
        const result = await getStudioApi().openResourceLogin(resource.id);
        setLoginId(result.loginId);
        setMessage(result.loginId ? '' : result.next);
      } else if (kind === 'install') {
        await getStudioApi().installResource(resource.id);
        setMessage('Пакет доступен в Pi. Назначенные агенты загрузят его при следующем открытии.');
      } else {
        const checked = await getStudioApi().checkResource(resource.id);
        setMessage(
          {
            available: 'Ресурс доступен. Назначенный агент загрузит его при следующем открытии.',
            needs_auth: 'Сервер требует входа через Pi.',
            unavailable: 'Ресурс недоступен. Проверьте настройки через помощника.',
            disabled: 'Сервер выключен в Pi.',
          }[checked.status],
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Не удалось выполнить операцию с ресурсом.',
      );
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="resource-native-actions">
      <div className="action-row">
        <Button
          disabled={!!busy}
          onClick={() => {
            void action('check');
          }}
        >
          {busy === 'check' ? 'Проверяем…' : 'Проверить'}
        </Button>
        {resource.kind === 'plugins' && (
          <Button
            disabled={!!busy}
            onClick={() => {
              void action('install');
            }}
          >
            {busy === 'install' ? 'Устанавливаем…' : 'Установить пакет'}
          </Button>
        )}
        {resource.kind === 'mcps' && resource.source.startsWith('pi:') && (
          <Button
            disabled={!!busy}
            onClick={() => {
              setMessage('');
              setError('');
              setSecretsOpen(true);
            }}
          >
            Защищённые параметры
          </Button>
        )}
        {resource.kind === 'mcps' && resource.source.startsWith('pi:') && (
          <Button
            disabled={!!busy}
            onClick={() => {
              void action('login');
            }}
          >
            Войти через Pi
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="subtle">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {secretsOpen && (
        <McpSecretsDialog resource={resource} onClose={() => setSecretsOpen(false)} />
      )}
      {loginId && (
        <ResourceAuthDialog
          id={loginId}
          name={resource.name}
          onClose={() => setLoginId(undefined)}
        />
      )}
    </div>
  );
}
