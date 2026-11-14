import { useStoredState } from '@/shared/storage/Storage';
import { ProfilesContext } from './AgentProfiles.context';
import { useContext, useState, type ReactNode } from 'react';
import type { Agent, Instruction } from '../../../../shared/studio';
import { createSystemAgents, type SystemAgent } from '../../../../shared/systemAgents';

function useProfilesState(initial: Agent[]) {
  const [agents, setAgents] = useStoredState<Agent[]>('agents', initial);
  const [systemAgents, setSystemAgents] = useStoredState<SystemAgent[]>('systemAgents', () =>
    createSystemAgents(() => crypto.randomUUID()),
  );
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [agentTab, setAgentTab] = useState('Промпт');
  const selectedAgent =
    agents.find((a) => a.id === agentId) ??
    systemAgents.find((a) => a.id === agentId) ??
    agents[0] ??
    systemAgents[0];
  const selectedSystemRole = systemAgents.find(
    (agent) => agent.id === selectedAgent?.id,
  )?.systemRole;
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
    setAgents((previous) => [...previous, agent]);
    setAgentId(agent.id);
    setAgentTab('Промпт');
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
    if (!agents.some((agent) => agent.id === id)) return;
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
    if (selectedSystemRole) {
      setSystemAgents((previous) =>
        previous.map((agent) =>
          agent.id === selectedAgent.id
            ? { ...agent, ...update, id: agent.id, systemRole: agent.systemRole }
            : agent,
        ),
      );
    } else
      setAgents((prev) =>
        prev.map((a) => (a.id === selectedAgent.id ? { ...a, ...update, id: a.id } : a)),
      );
  };
  const updateInstruction = (id: string, update: Partial<Instruction>) => {
    if (!selectedAgent) return;
    updateAgent({
      instructions: selectedAgent.instructions.map((i) => (i.id === id ? { ...i, ...update } : i)),
    });
  };
  return {
    agents,
    systemAgents,
    selectedSystemRole,
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
export function AgentProfilesProvider({
  children,
  initial = [],
}: {
  children: ReactNode;
  initial?: Agent[];
}) {
  return (
    <ProfilesContext.Provider value={useProfilesState(initial)}>
      {children}
    </ProfilesContext.Provider>
  );
}
export function useAgentProfiles() {
  const value = useContext(ProfilesContext);
  if (!value) throw new Error('AgentProfilesProvider is missing');
  return value;
}
