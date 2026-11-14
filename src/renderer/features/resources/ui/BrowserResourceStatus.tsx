import { useEffect, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import { browserMcp } from '../../../../shared/builtinResources';

export function BrowserResourceStatus() {
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('Проверяем компоненты…');
  useEffect(() => {
    if (!window.studio) return;
    let active = true;
    void getStudioApi()
      .checkResource(browserMcp.id)
      .then((check) => {
        if (!active) return;
        setInstalled(check.status === 'available');
        setMessage(
          check.status === 'available'
            ? 'Компоненты установлены.'
            : 'Компоненты ещё не установлены.',
        );
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : 'Не удалось проверить компоненты.');
      });
    return () => {
      active = false;
    };
  }, []);
  const install = async () => {
    setBusy(true);
    setMessage('Загружаем agent-browser и Chromium…');
    try {
      await getStudioApi().installResource(browserMcp.id);
      setInstalled(true);
      setMessage('Компоненты установлены. Браузер откроется при обращении агента к инструменту.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось установить компоненты.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-native-actions">
      <p className="subtle" role="status">
        {message}
      </p>
      {!installed && window.studio && (
        <Button
          kind="primary"
          disabled={busy}
          onClick={() => {
            void install();
          }}
        >
          {busy ? 'Устанавливаем…' : 'Установить компоненты браузера'}
        </Button>
      )}
    </div>
  );
}
