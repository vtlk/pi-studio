import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useChatPanels } from './ChatPanels.context';
import { ChatPanel } from './ChatPanel';

export function SetupChatPanel() {
  const { target } = useChatPanels(),
    { systemAgents } = useAgentProfiles();
  if (target?.projectId !== 'pi-setup-assistant') return null;
  return (
    <ChatPanel
      key={`${target.projectId}/${target.agentId}`}
      target={target}
      name={systemAgents.find((agent) => agent.id === target.agentId)?.name ?? 'Pi'}
      standalone
    />
  );
}
