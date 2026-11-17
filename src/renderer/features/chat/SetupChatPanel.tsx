import { useTranslation } from 'react-i18next';
import { i18n } from '../../../shared/i18n';
import { agentName } from '@/shared/model/localizedProfiles';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useChatPanels } from './ChatPanels.context';
import { ChatPanel } from './ChatPanel';

export function SetupChatPanel({ inline = false }: { inline?: boolean }) {
  useTranslation(undefined, { i18n });
  const { target } = useChatPanels(),
    { systemAgents } = useAgentProfiles();
  const assistant = systemAgents.find((agent) => agent.id === target?.agentId);
  if (target?.projectId !== 'pi-setup-assistant') return null;
  return (
    <ChatPanel
      key={`${target.projectId}/${target.agentId}`}
      target={target}
      name={assistant ? agentName(assistant) : 'Pi'}
      standalone={!inline}
    />
  );
}
