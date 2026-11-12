import { cp, mkdir, readdir, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { WorkspaceProject } from '../../shared/project.ts';
import type { ProjectCommand, ProjectCommandResult } from '../../shared/storage.ts';
import { atomicJson, folderLabel, isMissing, readJson, safePath } from './files.ts';
import {
  parseAgents,
  parseProject,
  projectDocument,
  snapshotAgent,
  stableId,
} from './validation.ts';
import { scanOutputs } from './outputs.ts';

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
          const project = parseProject(await readJson(file));
          project.folderName = entry.name;
          if (target.has(project.id) || (relative !== 'projects' && this.projects.has(project.id)))
            throw new Error('Повторяющийся ID проекта.');
          target.set(project.id, project);
        } catch (error) {
          warnings.push(
            `${relative}/${entry.name}: ${error instanceof Error ? error.message : 'ошибка чтения'}`,
          );
        }
      }
    }
    return warnings;
  }
  list() {
    return [...this.projects.values()].sort((a, b) => b.createdAt - a.createdAt);
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
    if (!project) throw new Error('Проект не найден.');
    return project;
  }
  async read(id: string): Promise<WorkspaceProject> {
    const project = this.get(id);
    const root = await this.directory(id);
    return {
      ...project,
      agents: await Promise.all(
        project.agents.map(async (agent) => {
          let session = agent.session;
          if (session) {
            try {
              await safePath(root, session.path);
            } catch {
              session = { ...session, missing: true };
            }
          }
          return { ...agent, session, entries: await scanOutputs(root, agent.outputPath) };
        }),
      ),
    };
  }
  private async save(project: WorkspaceProject, root: string) {
    await atomicJson(await safePath(root, 'project.json', true), projectDocument(project));
  }
  private async ensureAgents(project: WorkspaceProject, root: string) {
    for (const agent of project.agents) {
      for (const sub of ['output', 'sessions'])
        await mkdir(await safePath(root, `agents/${agent.profile.id}/${sub}`, true), {
          recursive: true,
        });
    }
  }
  private async available(name: string) {
    const path = await safePath(this.root, `projects/${name}`, true);
    try {
      await lstat(path);
    } catch (error) {
      if (isMissing(error)) return path;
      throw error;
    }
    throw new Error('Папка с таким названием уже существует. Выберите другое имя.');
  }
  async command(command: ProjectCommand): Promise<ProjectCommandResult> {
    let selectedId: string | undefined;
    if (command.kind === 'create' || command.kind === 'clone') {
      const name = folderLabel(command.name);
      const destination = await this.available(name);
      const staging = await safePath(this.root, `projects/.creating-${randomUUID()}`, true);
      let project: WorkspaceProject;
      try {
        if (command.kind === 'clone') {
          const source = this.get(command.projectId);
          await cp(await this.directory(source.id), staging, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            force: false,
            filter: async (path) => {
              if ((await lstat(path)).isSymbolicLink())
                throw new Error(
                  'В проекте есть символическая ссылка. Перенесите материал внутрь проекта перед клонированием.',
                );
              return true;
            },
          });
          project = {
            ...structuredClone(source),
            id: randomUUID(),
            name,
            folderName: name,
            createdAt: Date.now(),
            autoContinue: false,
            agents: source.agents.map((agent) => ({
              ...agent,
              entries: [],
              session: agent.session ? { ...agent.session, needsFork: true } : undefined,
            })),
          };
        } else {
          await mkdir(staging);
          project = {
            id: randomUUID(),
            name,
            folderName: name,
            createdAt: Date.now(),
            autoContinue: false,
            agents: parseAgents(command.agents).map(snapshotAgent),
          };
        }
        await this.ensureAgents(project, staging);
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
      if (!project) throw new Error('Удалённый проект не найден.');
      if (this.projects.has(project.id))
        throw new Error('Активный проект уже использует этот ID. Восстановление остановлено.');
      const name = project.name;
      const destination = await this.available(folderLabel(name));
      await rename(await safePath(this.root, `.pistudio/trash/${project.folderName}`), destination);
      const restored = { ...project, folderName: name };
      this.projects.set(project.id, restored);
      this.deleted.delete(project.id);
      selectedId = project.id;
    } else {
      const project = this.get(command.projectId);
      const root = await this.directory(project.id);
      if (command.kind === 'remove') {
        const destination = await safePath(this.root, `.pistudio/trash/${project.id}`, true);
        try {
          await lstat(destination);
          throw new Error('В корзине уже есть проект с этим ID.');
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(root, destination);
        this.deleted.set(project.id, { ...project, folderName: project.id });
        this.projects.delete(project.id);
      } else if (command.kind === 'rename') {
        const name = folderLabel(command.name);
        if (name !== project.folderName) {
          if (project.agents.some((agent) => agent.session))
            throw new Error(
              'Переименование проекта с сессией Pi требует поддержки ветвления. Пока сохраните текущую папку.',
            );
          const destination = await this.available(name);
          await rename(root, destination);
          const updated = { ...project, name, folderName: name };
          try {
            await this.save(updated, destination);
          } catch (error) {
            await rename(destination, root);
            throw error;
          }
          this.projects.set(project.id, updated);
        }
      } else if (command.kind === 'update-agents') {
        const current = parseAgents(command.agents);
        const existing = new Map(project.agents.map((agent) => [agent.profile.id, agent]));
        const next = {
          ...project,
          agents: [
            ...current.filter((agent) => !existing.has(agent.id)).map(snapshotAgent),
            ...project.agents.map((agent) => {
              const profile = current.find((item) => item.id === agent.profile.id);
              return command.updateExisting && profile
                ? { ...agent, profile: snapshotAgent(profile).profile }
                : agent;
            }),
          ],
        };
        await this.ensureAgents(next, root);
        await this.save(next, root);
        this.projects.set(project.id, next);
      } else throw new Error('Неизвестная операция проекта.');
    }
    return { projects: this.list(), trashProjects: this.trash(), selectedId };
  }
}
