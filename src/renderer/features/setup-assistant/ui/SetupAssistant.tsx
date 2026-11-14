import { Button } from '@/shared/ui';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useNavigation } from '@/shared/model/Navigation';
import { useOpenSetupAssistant } from '../model/useOpenSetupAssistant';

export function SetupAssistant() {
  const { systemAgents, setAgentId, setAgentTab } = useAgentProfiles();
  const { connections } = useConnections();
  const { navigate } = useNavigation();
  const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
  const model = assistant?.model;
  const connection = connections.find((item) => item.id === model?.connectionId);
  const { open, opening, error } = useOpenSetupAssistant();
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
          disabled={opening || !assistant?.enabled}
          onClick={() => void open()}
        >
          {opening ? 'Открываем Pi…' : 'Открыть помощника в Pi'}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
