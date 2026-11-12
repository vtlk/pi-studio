import { useStoredState } from '@/shared/storage/Storage';
import { ProfilesContext } from './AgentProfiles.context';
import { useContext, useState, type ReactNode } from 'react';
import { initialAgents, type Agent, type Instruction } from '@/fixtures/studio';

function useProfilesState() {
  const [agents, setAgents] = useStoredState('agents', initialAgents);
  const [agentId, setAgentId] = useState(initialAgents[0].id);
  const [agentTab, setAgentTab] = useState('Инструкции');
  const selectedAgent = agents.find((a) => a.id === agentId) ?? agents[0];
  const addAgent = () => {
    const agent: Agent = {
      id: crypto.randomUUID(),
      name: 'Новый агент',
      enabled: true,
      instructions: [],
      skills: [],
      mcps: [],
      plugins: [],
    };
    setAgents((previous) => [agent, ...previous]);
    setAgentId(agent.id);
    setAgentTab('Инструкции');
  };
  const moveAgent = (fromId: string, toId: string) =>
    setAgents((previous) => {
      const from = previous.findIndex((agent) => agent.id === fromId);
      const to = previous.findIndex((agent) => agent.id === toId);
      if (from < 0 || to < 0 || from === to) return previous;
      const next = [...previous];
      const [agent] = next.splice(from, 1);
      next.splice(to, 0, agent);
      return next;
    });
  const removeAgent = (id: string) => {
    const position = agents.findIndex((agent) => agent.id === id);
    setAgents((previous) => previous.filter((agent) => agent.id !== id));
    if (selectedAgent?.id === id)
      setAgentId(agents[position + 1]?.id ?? agents[position - 1]?.id ?? '');
  };
  const restoreAgent = (agent: Agent, position: number) => {
    setAgents((previous) => {
      if (previous.some((item) => item.id === agent.id)) return previous;
      const next = [...previous];
      next.splice(position, 0, agent);
      return next;
    });
    setAgentId(agent.id);
  };
  const updateAgent = (update: Partial<Agent>) => {
    if (!selectedAgent) return;
    setAgents((prev) => prev.map((a) => (a.id === selectedAgent.id ? { ...a, ...update } : a)));
  };
  const updateInstruction = (id: string, update: Partial<Instruction>) => {
    if (!selectedAgent) return;
    updateAgent({
      instructions: selectedAgent.instructions.map((i) => (i.id === id ? { ...i, ...update } : i)),
    });
  };
  return {
    agents,
    agentId,
    setAgentId,
    agentTab,
    setAgentTab,
    selectedAgent,
    addAgent,
    moveAgent,
    removeAgent,
    restoreAgent,
    updateAgent,
    updateInstruction,
  };
}
export type ProfilesContextValue = ReturnType<typeof useProfilesState> | null;
export function AgentProfilesProvider({ children }: { children: ReactNode }) {
  return <ProfilesContext.Provider value={useProfilesState()}>{children}</ProfilesContext.Provider>;
}
export function useAgentProfiles() {
  const value = useContext(ProfilesContext);
  if (!value) throw new Error('AgentProfilesProvider is missing');
  return value;
}
