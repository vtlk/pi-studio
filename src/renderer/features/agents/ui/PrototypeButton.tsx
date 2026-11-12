import { useLaunch } from '@/features/launch/model/Launch';
import { useAgentProfiles } from '../model/AgentProfiles';
import { Button } from '@/shared/ui';

export function PrototypeButton({
  title = 'Запустить агента',
  description,
  agentId = 'scenes',
}: {
  title?: string;
  description?: string;
  agentId?: string;
}) {
  const { openRun } = useLaunch();
  const { agents } = useAgentProfiles();
  const agent = agents.find((item) => item.id === agentId);
  return (
    <Button
      kind="primary"
      disabled={!agent?.enabled}
      onClick={() => openRun(title, description ?? `Агент: ${agent?.name ?? agentId}.`, agentId)}
    >
      {title}
    </Button>
  );
}
