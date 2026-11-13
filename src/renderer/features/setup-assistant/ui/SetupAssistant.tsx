import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useNavigation } from '@/shared/model/Navigation';

export function SetupAssistant() {
  const { demo } = useNotice();
  const { saveNow } = useStorage();
  const { systemAgents, setAgentId, setAgentTab } = useAgentProfiles();
  const { connections } = useConnections();
  const { navigate } = useNavigation();
  const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
  const model = assistant?.model;
  const connection = connections.find((item) => item.id === model?.connectionId);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <h2>Помощник подключения</h2>
      <p>
        Подключение skills, MCP и пакетов Pi, а также выдача доступа агентам — в диалоге с
        помощником в Pi.
      </p>
      <p aria-label="Модель помощника подключения">
        Подключение: {connection?.name || (model?.connectionId ? 'недоступно' : 'не выбрано')}
        {' · '}Модель: {model?.id || 'не выбрана'}
        {' · '}Уровень рассуждения: {model?.reasoning || 'не выбран'}
      </p>
      <div className="action-row">
        <Button
          disabled={!assistant || opening}
          onClick={() => {
            if (!assistant) return;
            setAgentId(assistant.id);
            setAgentTab('Модель');
            navigate('agents');
          }}
        >
          Настройки модели помощника
        </Button>
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
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
