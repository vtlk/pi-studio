import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectCommand } from '../../../../shared/storage';
import type { SessionBinding, WorkspaceProject } from './workspace.types';
import { useStorage } from '@/shared/storage/Storage';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';

export function useNativeWorkspaceState() {
  const { bootstrap, isDesktop } = useStorage();
  const { agents } = useAgentProfiles();
  const { demo } = useNotice();
  const [projects, setProjects] = useState(bootstrap?.projects ?? []);
  const [trashProjects, setTrashProjects] = useState(bootstrap?.trashProjects ?? []);
  const [projectId, setProjectId] = useState(bootstrap?.projects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const reading = useRef(false);
  const lastReadError = useRef('');
  const generation = useRef(0);
  const selectedProject = projects.find((project) => project.id === projectId);

  const command = async (action: ProjectCommand) => {
    if (!window.studio || mutating.current) return false;
    mutating.current = true;
    setBusy(true);
    generation.current++;
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
      demo(error instanceof Error ? error.message : 'Ошибка файловой операции.');
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
      generation.current++;
    }
  };

  const reload = useCallback(async () => {
    if (!isDesktop || !projectId || mutating.current || reading.current) return;
    reading.current = true;
    const version = generation.current;
    try {
      const project = await window.studio!.readProject(projectId);
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
      const message = `Не удалось прочитать результаты: ${error instanceof Error ? error.message : 'ошибка'}`;
      if (lastReadError.current !== message) demo(message);
      lastReadError.current = message;
    } finally {
      reading.current = false;
    }
  }, [projectId, isDesktop, demo]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [reload]);

  return {
    projects,
    trashProjects,
    selectedProject,
    setProjectId,
    busy,
    createProject: (name: string) => command({ kind: 'create', name, agents }),
    refreshAgents: (updateExisting: boolean) =>
      command({ kind: 'update-agents', projectId, agents, updateExisting }),
    removeProject: (id: string) => command({ kind: 'remove', projectId: id }),
    restoreProject: (project: WorkspaceProject) =>
      command({ kind: 'restore', projectId: project.id }),
    renameProject: (id: string, name: string) => command({ kind: 'rename', projectId: id, name }),
    cloneProject: (source: WorkspaceProject, name: string) =>
      command({ kind: 'clone', projectId: source.id, name }),
    addSession: (
      _agentId: string,
      _message: string,
      _autoContinue = false,
    ): SessionBinding | undefined => {
      demo('Pi установлен отдельно. Запуск из Studio ещё не подключён; диалог не создан.');
      return undefined;
    },
    setAutoContinue: (_enabled: boolean) => {},
    reviewFile: (_projectId: string, _fileId: string, _accept: boolean) => {},
  };
}
