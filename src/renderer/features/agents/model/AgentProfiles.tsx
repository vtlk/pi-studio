import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useStoredState } from '@/shared/storage/Storage';
import { ProfilesContext } from './AgentProfiles.context';
import { useContext, useState, type ReactNode } from 'react';
import type { AgentCatalog, AgentTeam, TeamWorkspaceMode } from '../../../../shared/agentTeams';
import { teamAgents, transferTeamAgent } from '../../../../shared/agentTeams';
import type { Agent, Instruction } from '../../../../shared/studio';
import { createSystemAgents, type SystemAgent } from '../../../../shared/systemAgents';

function useProfilesState(initial: Agent[]) {
  useTranslation(undefined, { i18n });
  const [catalog, writeCatalog] = useStoredState<AgentCatalog>('agentCatalog', () => ({
    agents: initial,
    teams: initial.length
      ? [
          {
            id: 'web-example-team',
            name: t('AgentProfiles.myTeam'),
            agentIds: initial.map((agent) => agent.id),
          },
        ]
      : [],
  }));
  const setCatalog = (action: (previous: AgentCatalog) => AgentCatalog) =>
    writeCatalog((previous) => {
      const next = action(previous);
      return { ...next, agents: next.teams.flatMap((team) => teamAgents(next, team.id)) };
    });
  const { agents, teams } = catalog;
  const setAgents = (action: (previous: Agent[]) => Agent[]) =>
    setCatalog((previous) => ({ ...previous, agents: action(previous.agents) }));
  const addTeam = (name: string, workspaceMode: TeamWorkspaceMode = 'per-agent') => {
    const team = { id: crypto.randomUUID(), name: name.trim(), workspaceMode, agentIds: [] };
    setCatalog((previous) => ({ ...previous, teams: [...previous.teams, team] }));
    return team.id;
  };
  const renameTeam = (id: string, name: string, workspaceMode?: TeamWorkspaceMode) =>
    setCatalog((previous) => ({
      ...previous,
      teams: previous.teams.map((team) =>
        team.id === id
          ? {
              ...team,
              name: name.trim(),
              ...(workspaceMode === undefined ? {} : { workspaceMode }),
            }
          : team,
      ),
    }));
  const removeTeam = (id: string) =>
    setCatalog((previous) => {
      const ids = new Set(previous.teams.find((team) => team.id === id)?.agentIds ?? []);
      return {
        agents: previous.agents.filter((agent) => !ids.has(agent.id)),
        teams: previous.teams.filter((team) => team.id !== id),
      };
    });
  const restoreTeam = (team: AgentTeam, profiles: Agent[], position: number) =>
    setCatalog((previous) => {
      if (previous.teams.some((item) => item.id === team.id)) return previous;
      const restored = profiles.filter(
        (agent) => !previous.agents.some((item) => item.id === agent.id),
      );
      const next = [...previous.teams];
      next.splice(Math.min(position, next.length), 0, {
        ...team,
        agentIds: restored.map((agent) => agent.id),
      });
      return { agents: [...previous.agents, ...restored], teams: next };
    });
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
  const addAgent = (teamId: string) => {
    if (!teams.some((team) => team.id === teamId)) return;
    const agent: Agent = {
      id: crypto.randomUUID(),
      name: t('AgentProfiles.newAgent'),
      enabled: true,
      instructions: [],
      skills: [],
      mcps: ['pistudio-project'],
      plugins: [],
    };
    setCatalog((previous) => ({
      agents: [...previous.agents, agent],
      teams: previous.teams.map((team) =>
        team.id === teamId ? { ...team, agentIds: [...team.agentIds, agent.id] } : team,
      ),
    }));
    setAgentId(agent.id);
    setAgentTab('Промпт');
  };
  const moveAgent = (fromId: string, toId: string) =>
    setCatalog((previous) => {
      const team = previous.teams.find(
        (team) => team.agentIds.includes(fromId) && team.agentIds.includes(toId),
      );
      if (!team || fromId === toId) return previous;
      const ids = [...team.agentIds];
      ids.splice(ids.indexOf(toId), 0, ...ids.splice(ids.indexOf(fromId), 1));
      const next = {
        ...previous,
        teams: previous.teams.map((item) =>
          item.id === team.id ? { ...item, agentIds: ids } : item,
        ),
      };
      return { ...next, agents: next.teams.flatMap((item) => teamAgents(next, item.id)) };
    });
  const transferAgent = (id: string, sourceTeamId: string, targetTeamId: string, copy: boolean) => {
    const nextId = copy ? crypto.randomUUID() : id;
    setCatalog((previous) =>
      transferTeamAgent(previous, id, sourceTeamId, targetTeamId, copy ? nextId : undefined),
    );
    setAgentId(nextId);
    return nextId;
  };
  const removeAgent = (id: string) => {
    const position = agents.findIndex((agent) => agent.id === id);
    setCatalog((previous) => ({
      agents: previous.agents.filter((agent) => agent.id !== id),
      teams: previous.teams.map((team) => ({
        ...team,
        agentIds: team.agentIds.filter((member) => member !== id),
      })),
    }));
    if (selectedAgent?.id === id)
      setAgentId(agents[position + 1]?.id ?? agents[position - 1]?.id ?? '');
  };
  const restoreAgent = (agent: Agent, position: number, teamId: string) => {
    setCatalog((previous) => {
      if (
        previous.agents.some((item) => item.id === agent.id) ||
        !previous.teams.some((team) => team.id === teamId)
      )
        return previous;
      return {
        agents: [...previous.agents, agent],
        teams: previous.teams.map((team) => {
          if (team.id !== teamId) return team;
          const agentIds = [...team.agentIds];
          agentIds.splice(Math.min(position, agentIds.length), 0, agent.id);
          return { ...team, agentIds };
        }),
      };
    });
    setAgentId(agent.id);
  };
  const updateAgent = (update: Partial<Agent> | ((current: Agent) => Partial<Agent>)) => {
    if (!selectedAgent) return;
    const patch = (current: Agent) => (typeof update === 'function' ? update(current) : update);
    if (selectedSystemRole) {
      setSystemAgents((previous) =>
        previous.map((agent) =>
          agent.id === selectedAgent.id
            ? { ...agent, ...patch(agent), id: agent.id, systemRole: agent.systemRole }
            : agent,
        ),
      );
    } else
      setAgents((prev) =>
        prev.map((a) => (a.id === selectedAgent.id ? { ...a, ...patch(a), id: a.id } : a)),
      );
  };
  const updateInstruction = (id: string, update: Partial<Instruction>) => {
    if (!selectedAgent) return;
    updateAgent((current) => ({
      instructions: current.instructions.map((i) => (i.id === id ? { ...i, ...update } : i)),
    }));
  };
  return {
    agents,
    teams,
    catalog,
    addTeam,
    renameTeam,
    removeTeam,
    restoreTeam,
    systemAgents,
    selectedSystemRole,
    agentId,
    setAgentId,
    agentTab,
    setAgentTab,
    selectedAgent,
    addAgent,
    moveAgent,
    transferAgent,
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
  useTranslation(undefined, { i18n });
  return (
    <ProfilesContext.Provider value={useProfilesState(initial)}>
      {children}
    </ProfilesContext.Provider>
  );
}
export function useAgentProfiles() {
  useTranslation(undefined, { i18n });
  const value = useContext(ProfilesContext);
  if (!value) throw new Error('AgentProfilesProvider is missing');
  return value;
}
