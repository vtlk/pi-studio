import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNavigation } from '@/shared/model/Navigation';
import { useNotice } from '@/shared/model/Notice';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';

export function AgentConfigurationDialog({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const { agents, setAgentId, setAgentTab } = useAgentProfiles();
  const { navigate } = useNavigation();
  const { demo } = useNotice();
  return (
    <Modal
      title="Настройка агента"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            onClick={() => {
              if (!agents.some((agent) => agent.id === agentId)) {
                demo('Этот агент удалён из конструктора. Другой профиль не подставляется.');
                return;
              }
              setAgentId(agentId);
              setAgentTab('Модель');
              onClose();
              navigate('agents');
            }}
          >
            Перейти
          </Button>
        </>
      }
    >
      <p>Сначала настройте подключение Агента в настройках агента</p>
    </Modal>
  );
}
