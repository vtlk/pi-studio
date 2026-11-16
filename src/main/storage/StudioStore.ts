import { t } from '../../shared/i18n/index.ts';
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
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createSystemAgents, type SystemAgent } from '../../shared/systemAgents.ts';
import type { Agent } from '../../shared/studio.ts';
import { retireLegacyFeatures } from './retireLegacyFeatures.ts';
import { ProjectAccounting } from '../accounting/ProjectAccounting.ts';
import type { AgentCatalog, AgentTeam } from '../../shared/agentTeams.ts';
import { teamAgents } from '../../shared/agentTeams.ts';
import { reconcileTeams } from './agentCatalog.ts';
import { snapshotAgent } from './validation.ts';
import type { Resource } from '../../shared/resources.ts';

export class StudioStore {
  private sections: StudioSections = {};
  readonly projects: ProjectStore;
  private warnings: string[] = [];
  readonly folder: string;
  readonly accounting: ProjectAccounting;
  private constructor(folder: string) {
    this.folder = folder;
    this.projects = new ProjectStore(folder);
    this.accounting = new ProjectAccounting(folder);
  }
  static async open(folder: string) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.includes('\0'))
      throw new Error(t('error.studioStore.anAbsoluteStudioFolderPath'));
    await mkdir(folder, { recursive: true });
    const store = new StudioStore(await realpath(folder));
    await mkdir(await safePath(store.folder, '.pistudio', true), { recursive: true });
    const file = await safePath(store.folder, '.pistudio/studio.json', true);
    let retired = false;
    try {
      const migration = retireLegacyFeatures(await readJson(file));
      store.sections = parseStudio(migration.document);
      retired = migration.changed;
    } catch (error) {
      if (!isMissing(error))
        throw new Error(
          t('error.studioStore.couldNotOpenStudioJson', {
            value1: error instanceof Error ? error.message : t('useNativeWorkspaceState.error'),
          }),
          { cause: error },
        );
      await atomicJson(file, { schemaVersion: 1, sections: {} });
    }
    const initial = store.sections;
    store.warnings = await store.projects.initialize();
    if (initial.agentTeams === undefined || retired) {
      const teams = reconcileTeams(
        (initial.agents ?? []) as Agent[],
        (initial.agentTeams ?? []) as AgentTeam[],
      );
      if (
        initial.agentTeams === undefined &&
        !teams.length &&
        (store.projects.list().length || store.projects.trash().length)
      )
        teams.push({ id: randomUUID(), name: 'Моя команда', agentIds: [] });
      const next = {
        ...initial,
        agentTeams: teams,
      };
      parseSection('agentCatalog', { agents: next.agents ?? [], teams: next.agentTeams });
      await atomicJson(file, { schemaVersion: 1, sections: next });
      store.sections = next;
    } else parseSection('agentCatalog', store.agentCatalog());
    const legacyTeamId =
      (store.sections.agentTeams as AgentTeam[])[0]?.id ?? 'legacy-unassigned-team';
    await store.projects.migrateLegacyTeam(legacyTeamId);
    await store.accounting.reconcile(store.projects.list(), store.projects.trash());
    for (const [key, value] of [
      ['agents', []],
      ['systemAgents', createSystemAgents(randomUUID)],
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
  /** One atomic local commit after the entire portable package has been validated/materialized. */
  async addImportedTeam(team: AgentTeam, agents: Agent[], resources: Resource[]) {
    const previous = this.agentCatalog();
    const currentResources = (this.sections.resources ?? []) as Resource[];
    const systemIds = new Set(
      ((this.sections.systemAgents ?? []) as SystemAgent[]).map((agent) => agent.id),
    );
    if (agents.some((agent) => systemIds.has(agent.id)))
      throw new Error(t('error.studioStore.theSystemAssistantIsExcluded'));
    if (
      previous.teams.some((item) => item.id === team.id) ||
      agents.some((agent) => previous.agents.some((item) => item.id === agent.id)) ||
      resources.some((resource) => currentResources.some((item) => item.id === resource.id))
    )
      throw new Error(t('error.studioStore.thisImportIdIsAlready'));
    const catalog = parseSection('agentCatalog', {
      agents: [...previous.agents, ...agents],
      teams: [...previous.teams, team],
    }) as AgentCatalog;
    const nextResources = parseSection('resources', [...resources, ...currentResources]);
    const sections = {
      ...this.sections,
      agents: catalog.agents,
      agentTeams: catalog.teams,
      resources: nextResources,
    };
    await atomicJson(await safePath(this.folder, '.pistudio/studio.json'), {
      schemaVersion: 1,
      sections,
    });
    this.sections = sections;
  }
  async saveSection(section: StorageSection, value: unknown) {
    const validated = parseSection(section, value);
    const systems = this.sections.systemAgents as SystemAgent[] | undefined;
    if (
      section === 'systemAgents' &&
      (validated as SystemAgent[]).some((item) => item.systemRole !== 'assistant')
    )
      throw new Error(t('error.studioStore.onlyTheSetupAssistantRemains'));
    if (section === 'systemAgents' && systems) {
      const next = validated as SystemAgent[];
      if (
        systems.some(
          (agent) =>
            !next.some((item) => item.systemRole === agent.systemRole && item.id === agent.id),
        )
      )
        throw new Error(t('error.studioStore.systemProfilesCannotBeDeleted'));
    }
    if (
      section === 'agents' &&
      systems &&
      (validated as Agent[]).some((agent) => systems.some((system) => system.id === agent.id))
    )
      throw new Error(t('error.studioStore.systemProfilesAreNotProject'));
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
      throw new Error(t('error.studioStore.theSystemAssistantIsExcluded2'));
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
      throw new Error(t('error.studioStore.theStudioFolderChangedEdits'));
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
        throw new Error(t('error.studioStore.theTeamMembershipChangedReload'));
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
          throw new Error(t('error.studioStore.theSourceTeamMembershipChanged'));
        command = { ...command, agents: current };
      }
    }
    if (
      (command.kind === 'create' || command.kind === 'update-agents') &&
      command.agents.some((agent) =>
        (this.sections.systemAgents as SystemAgent[]).some((system) => system.id === agent.id),
      )
    )
      throw new Error(t('error.studioStore.systemAgentsAreExcludedFrom'));
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
        throw new Error(t('error.studioStore.invalidLastStudioPath'));
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
