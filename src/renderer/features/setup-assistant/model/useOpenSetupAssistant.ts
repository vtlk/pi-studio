import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';

/** Both entry points use the same save-before-open path and the one canonical service dialogue. */
export function useOpenSetupAssistant() {
  const { saveNow } = useStorage();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      if (!window.studio) throw new Error('Помощник доступен в приложении macOS.');
      if (!(await saveNow())) throw new Error('Дождитесь сохранения настроек.');
      await window.studio.openSetupAssistant();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось открыть помощника.';
      setError(message);
      return message;
    } finally {
      setOpening(false);
    }
  };
  return { open, opening, error };
}
