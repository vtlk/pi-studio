import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { teamAgents } from '../../../../shared/agentTeams';
import type { AgentDataTarget } from '../../../../shared/storage';
import { folderSlug } from '../../../../shared/folderSlug';
import { useState } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { initialAgents } from '@/fixtures/agents';
import { demoOutputs } from '@/fixtures/projectOutputs';
import { demoAgentActivity } from '@/fixtures/agentActivity';
import { snapshotAgents, refreshSnapshot, getCurrentAgentInstructions } from './snapshot';
import { getAgentLaunchAction } from './session';
import type { SessionBinding, WorkspaceProject } from './workspace.types';
import {
  archiveProjectAgent,
  restoreProjectAgent as restoreArchivedAgent,
  synchronizeProjectAgentList,
} from '../../../../shared/projectAgents';

export function useDemoWorkspaceState() {
  useTranslation(undefined, { i18n });
  const { agents, catalog } = useAgentProfiles();
  const [projects, setProjects] = useState<WorkspaceProject[]>(() => [
    {
      id: 'demo-project',
      sourceTeamId: 'web-example-team',
      name: t('useDemoWorkspaceState.aParcelWithCharacter'),
      createdAt: 1,
      agents: snapshotAgents(initialAgents).map((agent) => ({
        ...agent,
        ...demoAgentActivity(agent.profile.id),
        entries: structuredClone(demoOutputs[agent.profile.id] ?? []),
      })),
    },
  ]);
  const [projectId, setProjectId] = useState('demo-project');
  const selectedProject = projects.find((item) => item.id === projectId);
  const createProject = (name: string, teamId: string) => {
    const project: WorkspaceProject = {
      id: crypto.randomUUID(),
      name: name.trim(),
      folderName: folderSlug(name),
      createdAt: Date.now(),
      sourceTeamId: teamId,
      agents: snapshotAgents(teamAgents(catalog, teamId)),
    };
    setProjects((previous) => [project, ...previous]);
    setProjectId(project.id);
  };
  const refreshAgents = (updateExisting: boolean) => {
    setProjects((previous) =>
      previous.map((project) =>
        project.id === projectId
          ? synchronizeProjectAgentList(
              project,
              refreshSnapshot(
                project.agents,
                teamAgents(catalog, project.sourceTeamId ?? ''),
                updateExisting,
                project.archivedAgents?.map((item) => item.agent),
              ),
            )
          : project,
      ),
    );
  };
  const removeProject = (id: string) => {
    setProjects((previous) => previous.filter((item) => item.id !== id));
  };
  const restoreProject = (project: WorkspaceProject) => {
    setProjects((previous) =>
      previous.some((item) => item.id === project.id)
        ? previous
        : [...previous, project].sort((a, b) => b.createdAt - a.createdAt),
    );
  };
  const addSession = (
    agentId: string,
    initialMessage: string,
    autoContinue = false,
  ): SessionBinding | undefined => {
    const agent = selectedProject?.agents.find((item) => item.profile.id === agentId);
    if (!initialMessage.trim() || !agent || getAgentLaunchAction(agent).kind !== 'start') return;
    if (!getCurrentAgentInstructions(agentId, agents)) return;
    const id = crypto.randomUUID();
    const session: SessionBinding = {
      id,
      title: t('useDemoWorkspaceState.projectDialogue'),
      path: `agents/${agentId}/sessions/${id}.jsonl`,
      createdAt: Date.now(),
      initialMessage,
    };
    setProjects((previous) =>
      previous.map((project) =>
        project.id !== projectId ||
        project.agents.some((item) => item.profile.id === agentId && item.session)
          ? project
          : {
              ...project,
              autoContinue,
              agents: project.agents.map((agent) => {
                if (agent.profile.id !== agentId) return agent;
                return {
                  ...agent,
                  session,
                };
              }),
            },
      ),
    );
    return session;
  };
  return {
    projects,
    selectedProject,
    setProjectId,
    createProject,
    refreshAgents,
    removeProjectAgent: (projectId: string, agentId: string) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === projectId ? archiveProjectAgent(project, agentId) : project,
        ),
      );
      return true;
    },
    restoreProjectAgent: (projectId: string, agentId: string) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === projectId ? restoreArchivedAgent(project, agentId) : project,
        ),
      );
      return true;
    },
    removeProject,
    restoreProject,
    addSession,
    setAutoContinue: (enabled: boolean) =>
      setProjects((previous) =>
        previous.map((project) =>
          project.id === projectId ? { ...project, autoContinue: enabled } : project,
        ),
      ),
    renameProject: (id: string, name: string) =>
      setProjects((previous) =>
        previous.map((project) =>
          project.id === id
            ? {
                ...project,
                name: name.trim(),
                folderName: folderSlug(name),
                agents: project.agents.map((agent) => ({
                  ...agent,
                  session: agent.session ? { ...agent.session, needsFork: true } : undefined,
                })),
              }
            : project,
        ),
      ),
    deleteAgentData: async (_projectId: string, _agentId: string, _target: AgentDataTarget) =>
      false,
    cloneProject: (source: WorkspaceProject, name: string) => {
      const cloned = structuredClone(source);
      cloned.agents = cloned.agents.map((agent) => ({
        ...agent,
        runStatus:
          agent.runStatus === 'running' || agent.runStatus === 'waiting'
            ? 'stopped'
            : agent.runStatus,
        session: agent.session ? { ...agent.session, needsFork: true } : undefined,
      }));
      const project = {
        ...cloned,
        autoContinue: false,
        id: crypto.randomUUID(),
        name: name.trim(),
        folderName: folderSlug(name),
        createdAt: Date.now(),
      };
      setProjects((previous) => [project, ...previous]);
      setProjectId(project.id);
    },
  };
}
