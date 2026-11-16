import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { teamAgents } from '../../../../shared/agentTeams';
import { getStudioApi } from '@/shared/desktopApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentDataTarget, ProjectCommand } from '../../../../shared/storage';
import type { SessionBinding, WorkspaceProject } from './workspace.types';
import { useStorage } from '@/shared/storage/Storage';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { useProjectUsage } from './useProjectUsage';

export function useNativeWorkspaceState() {
  useTranslation(undefined, { i18n });
  const { bootstrap, isDesktop, saveNow } = useStorage();
  const { catalog } = useAgentProfiles();
  const { demo } = useNotice();
  const [projects, setProjects] = useState(bootstrap?.projects ?? []);
  const [trashProjects, setTrashProjects] = useState(bootstrap?.trashProjects ?? []);
  const [projectId, setProjectId] = useState(bootstrap?.projects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const reading = useRef(false);
  const lastReadError = useRef('');
  const generation = useRef(0);
  useProjectUsage(setProjects, generation);
  const invalidateReads = useCallback(() => {
    generation.current++;
  }, []);
  const selectedProject = projects.find((project) => project.id === projectId);
  const openAgent = async (
    agentId: string,
    message?: string,
    autoContinue = false,
    attachments: string[] = [],
  ) => {
    if (!window.studio || mutating.current) return undefined;
    if (!(await saveNow())) {
      demo(t('useNativeWorkspaceState.saveCurrentSettingsChangesFirst'));
      return undefined;
    }
    if (mutating.current) return undefined;
    mutating.current = true;
    setBusy(true);
    invalidateReads();
    try {
      const result = await window.studio.launchAgent({
        projectId,
        agentId,
        firstMessage: message,
        autoContinue,
        attachments,
      });
      setProjects((previous) =>
        previous.map((project) => (project.id === result.project.id ? result.project : project)),
      );
      return result.project.agents.find((agent) => agent.profile.id === agentId)?.session;
    } catch (error) {
      demo(error instanceof Error ? error.message : t('useNativeWorkspaceState.couldNotOpenPi'));
      return undefined;
    } finally {
      mutating.current = false;
      setBusy(false);
      invalidateReads();
    }
  };

  const command = async (action: ProjectCommand) => {
    if (!window.studio || mutating.current) return false;
    mutating.current = true;
    setBusy(true);
    invalidateReads();
    try {
      const result = await window.studio.projectCommand(action);
      setProjects(result.projects);
      setTrashProjects(result.trashProjects);
      if (result.selectedId) setProjectId(result.selectedId);
      else
        setProjectId((id) =>
          result.projects.some((project) => project.id === id)
            ? id
            : (result.projects[0]?.id ?? ''),
        );
      return true;
    } catch (error) {
      demo(
        error instanceof Error ? error.message : t('useNativeWorkspaceState.fileOperationError'),
      );
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
      invalidateReads();
    }
  };

  const reload = useCallback(async () => {
    if (!isDesktop || !projectId || mutating.current || reading.current) return;
    reading.current = true;
    const version = generation.current;
    try {
      const project = await getStudioApi().readProject(projectId);
      if (version !== generation.current) return;
      lastReadError.current = '';
      setProjects((previous) =>
        previous.map((item) =>
          item.id === project.id && JSON.stringify(item) !== JSON.stringify(project)
            ? project
            : item,
        ),
      );
    } catch (error) {
      if (version !== generation.current) return;
      const message = t('useNativeWorkspaceState.couldNotReadResults', {
        value1: error instanceof Error ? error.message : t('useNativeWorkspaceState.error'),
      });
      if (lastReadError.current !== message) demo(message);
      lastReadError.current = message;
    } finally {
      reading.current = false;
    }
  }, [projectId, isDesktop, demo]);
  const deleteAgentData = async (projectId: string, agentId: string, target: AgentDataTarget) => {
    if (!window.studio || !bootstrap || mutating.current) return false;
    mutating.current = true;
    setBusy(true);
    invalidateReads();
    try {
      const project = await window.studio.deleteAgentData({
        folder: bootstrap.folder,
        projectId,
        agentId,
        target,
      });
      setProjects((previous) => previous.map((item) => (item.id === project.id ? project : item)));
      demo(
        target === 'dialogue'
          ? t('useNativeWorkspaceState.dialogueDeletedYouCanStartANew')
          : target === 'files'
            ? t('useNativeWorkspaceState.agentFilesMovedToMacosTrashDialogue')
            : t('useNativeWorkspaceState.agentDialogueAndFilesDeletedYouCan'),
      );
      return true;
    } catch (error) {
      demo(
        error instanceof Error
          ? error.message
          : t('useNativeWorkspaceState.couldNotDeleteAgentData'),
      );
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
      invalidateReads();
    }
  };
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 3000);
    return () => {
      invalidateReads();
      clearInterval(timer);
    };
  }, [reload, invalidateReads]);

  return {
    projects,
    trashProjects,
    selectedProject,
    setProjectId,
    busy,
    deleteAgentData,
    createProject: async (name: string, teamId: string) =>
      (await saveNow())
        ? command({ kind: 'create', name, teamId, agents: teamAgents(catalog, teamId) })
        : false,
    refreshAgents: async (updateExisting: boolean) =>
      (await saveNow())
        ? command({
            kind: 'update-agents',
            projectId,
            agents: teamAgents(catalog, selectedProject?.sourceTeamId ?? ''),
            updateExisting,
          })
        : false,
    removeProjectAgent: (projectId: string, agentId: string) =>
      command({ kind: 'remove-agent', projectId, agentId }),
    restoreProjectAgent: (projectId: string, agentId: string) =>
      command({ kind: 'restore-agent', projectId, agentId }),
    removeProject: (id: string) => command({ kind: 'remove', projectId: id }),
    restoreProject: (project: WorkspaceProject) =>
      command({ kind: 'restore', projectId: project.id }),
    renameProject: (id: string, name: string) => command({ kind: 'rename', projectId: id, name }),
    cloneProject: (source: WorkspaceProject, name: string) =>
      command({ kind: 'clone', projectId: source.id, name }),
    addSession: (
      agentId: string,
      message: string,
      autoContinue = false,
      attachments: string[] = [],
    ): Promise<SessionBinding | undefined> =>
      openAgent(agentId, message, autoContinue, attachments),
    setAutoContinue: (_enabled: boolean) => {},
  };
}
