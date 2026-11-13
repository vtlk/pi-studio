import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';

export function SetupAssistant() {
  const { demo } = useNotice();
  const { saveNow } = useStorage();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <h2>Помощник подключения</h2>
      <p>
        Подключение skills, MCP и пакетов Pi, а также выдача доступа агентам — в диалоге с
        помощником в Pi.
      </p>
      <Button
        kind="primary"
        disabled={opening}
        onClick={async () => {
          if (!window.studio) {
            demo('Помощник доступен в приложении macOS.');
            return;
          }
          setOpening(true);
          setError('');
          try {
            if (!(await saveNow())) throw new Error('Дождитесь сохранения настроек.');
            await window.studio.openSetupAssistant();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Не удалось открыть помощника.');
          } finally {
            setOpening(false);
          }
        }}
      >
        {opening ? 'Открываем Pi…' : 'Открыть помощника в Pi'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
