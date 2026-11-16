import { t } from '../../shared/i18n/index.ts';
import { migrateProjectSessions, prepareProjectAgentSessions } from './migrateAgentSessions.ts';
import { availableProjectDirectory } from './projectFolders.ts';
import { readProject } from './readProject.ts';
import { ensureProjectAgents } from './ensureProjectAgents.ts';
import { migrateProjectTeams } from './migrateProjectTeams.ts';
import { cp, mkdir, readdir, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { RunFailure } from '../../shared/runFailure.ts';
import { join } from 'node:path';
import type { WorkspaceProject, SessionBinding, AgentRunStatus } from '../../shared/project.ts';
import type { ProjectCommand, ProjectCommandResult } from '../../shared/storage.ts';
import { atomicJson, folderLabel, isMissing, readJson, safePath } from './files.ts';
import {
  parseAgents,
  parseProject,
  projectDocument,
  snapshotAgent,
  snapshotProjectAgents,
  stableId,
} from './validation.ts';
import {
  archiveProjectAgent,
  restoreProjectAgent,
  synchronizeProjectAgentList,
} from '../../shared/projectAgents.ts';
import type { TeamWorkspaceMode } from '../../shared/agentTeams.ts';
import { parseTeamWorkspaceMode } from '../../shared/agentTeams.ts';
import { agentRuntimeDirectory } from '../../shared/agentPaths.ts';
import { folderSlug } from '../../shared/folderSlug.ts';
import type { Agent } from '../../shared/studio.ts';
import { assertProjectSessionsClosed } from './sessionLease.ts';
import { withAgentRuntime, withFork, withAgentModel } from './projectRuntime.ts';

export class ProjectStore {
  private projects = new Map<string, WorkspaceProject>();
  private deleted = new Map<string, WorkspaceProject>();
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async initialize() {
    await mkdir(await safePath(this.root, 'projects', true), { recursive: true });
    await mkdir(await safePath(this.root, '.pistudio/trash', true), { recursive: true });
    const warnings: string[] = [];
    for (const [relative, target] of [
      ['projects', this.projects],
      ['.pistudio/trash', this.deleted],
    ] as const) {
      const path = await safePath(this.root, relative);
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        try {
          const directory = await safePath(this.root, `${relative}/${entry.name}`);
          const file = await safePath(directory, 'project.json');
          const project = await migrateProjectSessions(
            directory,
            parseProject(await readJson(file)),
            (message) => warnings.push(`${relative}/${entry.name}: ${message}`),
          );
          project.folderName = entry.name;
          if (target.has(project.id) || (relative !== 'projects' && this.projects.has(project.id)))
            throw new Error(t('error.projectStore.duplicateProjectId'));
          target.set(project.id, project);
        } catch (error) {
          // A manifest defines a Studio project; arbitrary output folders are not broken projects.
          if (isMissing(error)) continue;
          warnings.push(
            `${relative}/${entry.name}: ${error instanceof Error ? error.message : t('error.projectStore.readError')}`,
          );
        }
      }
    }
    return warnings;
  }
  list() {
    return [...this.projects.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async migrateLegacyTeam(teamId: string) {
    await migrateProjectTeams(this.root, this.projects, this.deleted, teamId);
  }
  trash() {
    return [...this.deleted.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async directory(id: string) {
    const project = this.get(id);
    return safePath(this.root, `projects/${project.folderName}`);
  }
  private get(id: string) {
    stableId(id);
    const project = this.projects.get(id);
    if (!project) throw new Error(t('error.projectStore.projectNotFound'));
    return project;
  }
  async updateRuntime(
    projectId: string,
    agentId: string,
    status: AgentRunStatus,
    session?: SessionBinding | null,
    failure?: RunFailure,
  ) {
    const project = this.get(projectId);
    const selected = project.agents.find((item) => item.profile.id === stableId(agentId));
    if (!selected) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
    const updated = {
      ...project,
      agents: project.agents.map((item) =>
        item === selected ? withAgentRuntime(item, status, session, failure) : item,
      ),
    };
    if (session !== undefined) await this.save(updated, await this.directory(projectId));
    this.projects.set(projectId, updated);
    return this.read(projectId);
  }
  async prepareAgentSessions(projectId: string, agentId: string) {
    const project = this.get(projectId);
    const root = await this.directory(projectId);
    const updated = await prepareProjectAgentSessions(root, project, stableId(agentId));
    if (updated !== project) {
      await this.save(updated, root);
      this.projects.set(projectId, updated);
    }
    return this.read(projectId);
  }
  /** Change only future launch context. Never relocate results or rewrite canonical dialogues. */
  async applyWorkspaceMode(projectId: string, mode: TeamWorkspaceMode) {
    const project = this.get(projectId);
    mode = parseTeamWorkspaceMode(mode);
    if ((project.workspaceMode ?? 'per-agent') !== mode) {
      const updated = { ...project, workspaceMode: mode };
      const root = await this.directory(projectId);
      await ensureProjectAgents(updated, root);
      await this.save(updated, root);
      this.projects.set(projectId, updated);
    }
    return this.read(projectId);
  }
  async applyAgentModel(projectId: string, agentId: string, model: NonNullable<Agent['model']>) {
    const project = this.get(projectId);
    const updated = withAgentModel(project, stableId(agentId), model);
    if (updated !== project) {
      await this.save(updated, await this.directory(projectId));
      this.projects.set(projectId, updated);
    }
    return this.read(projectId);
  }
  async read(id: string): Promise<WorkspaceProject> {
    return readProject(this.get(id), await this.directory(id));
  }
  private async save(project: WorkspaceProject, root: string) {
    await atomicJson(await safePath(root, 'project.json', true), projectDocument(project));
  }
  async command(command: ProjectCommand): Promise<ProjectCommandResult> {
    let selectedId: string | undefined;
    if (command.kind === 'create' || command.kind === 'clone') {
      const name = folderLabel(command.name);
      const folderName = folderSlug(name);
      const destination = await availableProjectDirectory(this.root, folderName);
      const staging = await safePath(this.root, `projects/.creating-${randomUUID()}`, true);
      let project: WorkspaceProject;
      try {
        if (command.kind === 'clone') {
          const source = this.get(command.projectId);
          const sourceRoot = await this.directory(source.id);
          const leases = new Set(
            [...source.agents, ...(source.archivedAgents ?? []).map((item) => item.agent)].map(
              (agent) =>
                join(sourceRoot, agentRuntimeDirectory(agent), '.pistudio-session-lock.json'),
            ),
          );
          await cp(sourceRoot, staging, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            force: false,
            filter: async (path) => {
              if (leases.has(path)) return false;
              if ((await lstat(path)).isSymbolicLink())
                throw new Error(t('error.projectStore.theProjectContainsASymbolic'));
              return true;
            },
          });
          project = {
            ...structuredClone(source),
            id: randomUUID(),
            name,
            folderName,
            createdAt: Date.now(),
            autoContinue: false,
            agents: source.agents.map((agent) => ({
              ...agent,
              entries: [],
              runStatus: undefined,
              session: agent.session ? { ...agent.session, needsFork: true } : undefined,
            })),
            archivedAgents: source.archivedAgents?.map(({ agent, position }) => ({
              position,
              agent: {
                ...agent,
                entries: [],
                runStatus: undefined,
                session: agent.session ? { ...agent.session, needsFork: true } : undefined,
              },
            })),
          };
        } else {
          await mkdir(staging);
          project = {
            id: randomUUID(),
            ...(command.teamId ? { sourceTeamId: stableId(command.teamId) } : {}),
            name,
            folderName,
            createdAt: Date.now(),
            autoContinue: false,
            ...(command.workspaceMode === undefined
              ? {}
              : { workspaceMode: parseTeamWorkspaceMode(command.workspaceMode) }),
            agents: snapshotProjectAgents(parseAgents(command.agents)).map((agent) =>
              command.workspaceMode === 'shared'
                ? { ...agent, runtimePath: `.pistudio/agents/${agent.profile.id}` }
                : agent,
            ),
          };
        }
        await ensureProjectAgents(project, staging);
        await this.save(project, staging);
        await rename(staging, destination);
        this.projects.set(project.id, project);
        selectedId = project.id;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    } else if (command.kind === 'restore') {
      const project = this.deleted.get(stableId(command.projectId));
      if (!project) throw new Error(t('error.projectStore.deletedProjectNotFound'));
      if (this.projects.has(project.id))
        throw new Error(t('error.projectStore.anActiveProjectAlreadyUses'));
      const name = project.name;
      const folderName = folderSlug(folderLabel(name));
      const destination = await availableProjectDirectory(this.root, folderName);
      const source = await safePath(this.root, `.pistudio/trash/${project.folderName}`);
      await rename(source, destination);
      const restored = {
        ...project,
        folderName,
        agents: project.agents.map(withFork),
        archivedAgents: project.archivedAgents?.map((item) => ({
          ...item,
          agent: withFork(item.agent),
        })),
      };
      try {
        await this.save(restored, destination);
      } catch (error) {
        await rename(destination, source);
        throw error;
      }
      this.projects.set(project.id, restored);
      this.deleted.delete(project.id);
      selectedId = project.id;
    } else {
      const project = this.get(command.projectId);
      const root = await this.directory(project.id);
      if (command.kind === 'remove') {
        await assertProjectSessionsClosed(project, root);
        const destination = await safePath(this.root, `.pistudio/trash/${project.id}`, true);
        try {
          await lstat(destination);
          throw new Error(t('error.projectStore.theTrashAlreadyContainsA'));
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(root, destination);
        this.deleted.set(project.id, { ...project, folderName: project.id });
        this.projects.delete(project.id);
      } else if (command.kind === 'remove-agent' || command.kind === 'restore-agent') {
        stableId(command.agentId);
        const updated =
          command.kind === 'remove-agent'
            ? archiveProjectAgent(project, command.agentId)
            : restoreProjectAgent(project, command.agentId);
        await this.save(updated, root);
        this.projects.set(project.id, updated);
      } else if (command.kind === 'rename') {
        const name = folderLabel(command.name);
        const folderName = folderSlug(name);
        if (folderName !== project.folderName) {
          const destination = await availableProjectDirectory(this.root, folderName);
          await assertProjectSessionsClosed(project, root);
          await rename(root, destination);
          const updated = {
            ...project,
            name,
            folderName,
            agents: project.agents.map(withFork),
            archivedAgents: project.archivedAgents?.map((item) => ({
              ...item,
              agent: withFork(item.agent),
            })),
          };
          try {
            await this.save(updated, destination);
          } catch (error) {
            await rename(destination, root);
            throw error;
          }
          this.projects.set(project.id, updated);
        } else if (name !== project.name) {
          const updated = { ...project, name };
          await this.save(updated, root);
          this.projects.set(project.id, updated);
        }
      } else if (command.kind === 'update-agents') {
        const current = parseAgents(command.agents);
        const existing = new Map(
          [...project.agents, ...(project.archivedAgents ?? []).map((item) => item.agent)].map(
            (agent) => [agent.profile.id, agent],
          ),
        );
        const added = new Map(
          snapshotProjectAgents(
            current.filter((agent) => !existing.has(agent.id)),
            await readdir(await safePath(root, 'agents', true)).catch((error) => {
              if (isMissing(error)) return [];
              throw error;
            }),
          ).map((agent) => [
            agent.profile.id,
            project.workspaceMode === 'shared'
              ? { ...agent, runtimePath: `.pistudio/agents/${agent.profile.id}` }
              : agent,
          ]),
        );
        const next = synchronizeProjectAgentList(
          project,
          current.map((profile) => {
            const previous = existing.get(profile.id);
            if (!previous) return added.get(profile.id)!;
            return command.updateExisting
              ? { ...previous, profile: snapshotAgent(profile).profile }
              : previous;
          }),
        );
        await ensureProjectAgents(next, root);
        await this.save(next, root);
        this.projects.set(project.id, next);
      } else throw new Error(t('error.projectStore.unknownProjectOperation'));
    }
    return { projects: this.list(), trashProjects: this.trash(), selectedId };
  }
}
