import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type {
  StorageSection,
  StudioBootstrap,
  StudioSections,
  ProjectCommand,
  SectionEdit,
  SectionSaveResult,
} from '../../shared/storage.ts';
import { atomicJson, isMissing, readJson, safePath } from './files.ts';
import { parseSection, parseStudio } from './validation.ts';
import { ProjectStore } from './ProjectStore.ts';
import { LibraryStore } from '../library/LibraryStore.ts';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createSystemAgents, type SystemAgent } from '../../shared/systemAgents.ts';
import type { Agent } from '../../shared/studio.ts';
import { migrateLibraryAgents } from './migrateLibraryAgents.ts';
import { ProjectAccounting } from '../accounting/ProjectAccounting.ts';
import type { AgentCatalog, AgentTeam } from '../../shared/agentTeams.ts';
import { teamAgents } from '../../shared/agentTeams.ts';
import { reconcileTeams } from './agentCatalog.ts';
import { snapshotAgent } from './validation.ts';

export class StudioStore {
  private sections: StudioSections = {};
  readonly projects: ProjectStore;
  readonly library: LibraryStore;
  private warnings: string[] = [];
  readonly folder: string;
  readonly accounting: ProjectAccounting;
  private constructor(folder: string) {
    this.folder = folder;
    this.projects = new ProjectStore(folder);
    this.accounting = new ProjectAccounting(folder);
    this.library = new LibraryStore(folder);
  }
  static async open(folder: string) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.includes('\0'))
      throw new Error('Нужен абсолютный путь к папке студии.');
    await mkdir(folder, { recursive: true });
    const store = new StudioStore(await realpath(folder));
    await mkdir(await safePath(store.folder, '.pistudio', true), { recursive: true });
    const file = await safePath(store.folder, '.pistudio/studio.json', true);
    try {
      store.sections = parseStudio(await readJson(file));
    } catch (error) {
      if (!isMissing(error))
        throw new Error(
          `Не удалось открыть studio.json: ${error instanceof Error ? error.message : 'ошибка'}`,
          { cause: error },
        );
      await atomicJson(file, { schemaVersion: 1, sections: {} });
    }
    const migrated = migrateLibraryAgents(store.sections);
    const initial = migrated ?? store.sections;
    if (initial.agentTeams === undefined || migrated) {
      const next = {
        ...initial,
        agentTeams: reconcileTeams(
          (initial.agents ?? []) as Agent[],
          (initial.agentTeams ?? []) as AgentTeam[],
        ),
      };
      parseSection('agentCatalog', { agents: next.agents ?? [], teams: next.agentTeams });
      await atomicJson(file, { schemaVersion: 1, sections: next });
      store.sections = next;
    } else parseSection('agentCatalog', store.agentCatalog());
    store.warnings = await store.projects.initialize();
    const legacyTeamId =
      (store.sections.agentTeams as AgentTeam[])[0]?.id ?? 'legacy-unassigned-team';
    await store.projects.migrateLegacyTeam(legacyTeamId);
    await store.accounting.reconcile(store.projects.list(), store.projects.trash());
    for (const [key, value] of [
      ['agents', []],
      ['systemAgents', createSystemAgents(randomUUID)],
      ['libraryAgents', { characters: '', locations: '' }],
      ['connections', []],
      ['resources', []],
      ['baseInstruction', ''],
    ] as const) {
      if (store.sections[key] === undefined) await store.saveSection(key, value);
    }
    return store;
  }
  bootstrap(): StudioBootstrap {
    return {
      folder: this.folder,
      sections: structuredClone({ ...this.sections, agentCatalog: this.agentCatalog() }),
      projects: this.projects.list().map((project) => this.accounting.enrich(project)),
      trashProjects: this.projects.trash().map((project) => this.accounting.enrich(project)),
      warnings: this.warnings,
    };
  }
  agentCatalog(): AgentCatalog {
    return {
      agents: (this.sections.agents ?? []) as Agent[],
      teams: (this.sections.agentTeams ?? []) as AgentTeam[],
    };
  }
  teamProfiles(teamId: string) {
    return teamAgents(this.agentCatalog(), teamId);
  }
  async saveSection(section: StorageSection, value: unknown) {
    const validated = parseSection(section, value);
    const systems = this.sections.systemAgents as SystemAgent[] | undefined;
    if (
      section === 'systemAgents' &&
      (validated as SystemAgent[]).some((item) => item.systemRole !== 'assistant')
    )
      throw new Error('В системной группе остаётся только помощник настройки.');
    if (section === 'systemAgents' && systems) {
      const next = validated as SystemAgent[];
      if (
        systems.some(
          (agent) =>
            !next.some((item) => item.systemRole === agent.systemRole && item.id === agent.id),
        )
      )
        throw new Error('Системные профили нельзя удалять, заменять или создавать вручную.');
    }
    if (
      section === 'agents' &&
      systems &&
      (validated as Agent[]).some((agent) => systems.some((system) => system.id === agent.id))
    )
      throw new Error('Системные профили не являются шаблонами для проектов.');
    const sections =
      section === 'agentCatalog'
        ? {
            ...this.sections,
            agents: (validated as AgentCatalog).agents,
            agentTeams: (validated as AgentCatalog).teams,
          }
        : { ...this.sections, [section]: validated };
    if (section === 'agents')
      sections.agentTeams = reconcileTeams(validated as Agent[], this.agentCatalog().teams);
    if (section === 'agentTeams')
      parseSection('agentCatalog', { agents: sections.agents ?? [], teams: validated });
    if (
      section === 'agentCatalog' &&
      systems &&
      (validated as AgentCatalog).agents.some((agent) =>
        systems.some((system) => system.id === agent.id),
      )
    )
      throw new Error('Системный помощник не входит в команды.');
    await atomicJson(await safePath(this.folder, '.pistudio/studio.json'), {
      schemaVersion: 1,
      sections,
    });
    this.sections = sections;
  }
  /** Called inside StudioService's mutation queue; stale renderer values cannot replace a section. */
  async editSection(
    section: StorageSection,
    value: unknown,
    edit: SectionEdit,
  ): Promise<SectionSaveResult> {
    if (!edit || edit.folder !== this.folder)
      throw new Error('Папка студии изменилась. Правки не записаны в другую студию.');
    const local = parseSection(section, value);
    const base = parseSection(section, edit.base);
    const current =
      section === 'agentCatalog' ? this.agentCatalog() : (this.sections[section] ?? base);
    if (isDeepStrictEqual(local, current)) return { saved: true, value: structuredClone(current) };
    if (!isDeepStrictEqual(base, current)) return { saved: false, value: structuredClone(current) };
    await this.saveSection(section, local);
    return { saved: true, value: structuredClone(local) };
  }
  async command(command: ProjectCommand) {
    if (command.kind === 'create' && command.teamId) {
      const current = this.teamProfiles(command.teamId);
      if (
        !isDeepStrictEqual(
          current.map((agent) => snapshotAgent(agent).profile),
          command.agents.map((agent) => snapshotAgent(agent).profile),
        )
      )
        throw new Error('Состав команды изменился. Перечитайте настройки перед созданием проекта.');
      command = { ...command, agents: current };
    }
    if (command.kind === 'update-agents') {
      const teamId = (await this.projects.read(command.projectId)).sourceTeamId;
      if (teamId) {
        const current = this.teamProfiles(teamId);
        if (
          !isDeepStrictEqual(
            current.map((agent) => snapshotAgent(agent).profile),
            command.agents.map((agent) => snapshotAgent(agent).profile),
          )
        )
          throw new Error('Состав исходной команды изменился. Откройте сравнение заново.');
        command = { ...command, agents: current };
      }
    }
    if (
      (command.kind === 'create' || command.kind === 'update-agents') &&
      command.agents.some((agent) =>
        (this.sections.systemAgents as SystemAgent[]).some((system) => system.id === agent.id),
      )
    )
      throw new Error('Системные агенты не включаются в проектные снимки.');
    const result = await this.projects.command(command);
    await this.accounting.reconcile(
      result.projects,
      result.trashProjects,
      command.kind === 'create' ? result.selectedId : undefined,
    );
    return {
      ...result,
      projects: result.projects.map((project) => this.accounting.enrich(project)),
      trashProjects: result.trashProjects.map((project) => this.accounting.enrich(project)),
    };
  }
}

/** One mutation queue for settings, folder changes and project operations. */
export class StudioService {
  private queue: Promise<unknown> = Promise.resolve();
  private current?: StudioStore;
  private readonly preferencesFile: string;
  private readonly defaultFolder: string;
  constructor(preferencesFile: string, defaultFolder: string) {
    this.preferencesFile = preferencesFile;
    this.defaultFolder = defaultFolder;
  }
  serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async load() {
    if (this.current) return this.current;
    let folder = this.defaultFolder;
    try {
      const saved = await readJson(this.preferencesFile);
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('folder' in saved) ||
        typeof saved.folder !== 'string'
      )
        throw new Error('Некорректный путь последней студии.');
      folder = saved.folder;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const next = await StudioStore.open(folder);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return this.current;
  }
  async open(folder: string) {
    const next = await StudioStore.open(folder);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return next.bootstrap();
  }
}
