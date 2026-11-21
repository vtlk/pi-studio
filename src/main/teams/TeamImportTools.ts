import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import type { StudioResources } from '../pi/StudioResources.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import { atomicJson } from '../storage/files.ts';
import { stableId } from '../storage/validation.ts';
import { listImports, readImport } from './importState.ts';
import type { ImportedTeamState } from './importTeam.ts';
import { importedMcpConfig } from './importedMcp.ts';
import { builtinResource, builtinResources } from '../../shared/builtinResources.ts';
import { settingsOutput } from '../pi/settingsOutput.ts';
import { assertAdministrationScope, isSetupAssistantRun } from '../pi/administrationScope.ts';

type CheckModel = (agent: Agent, store: StudioStore) => Promise<void>;
export class TeamImportTools {
  private readonly service: StudioService;
  private readonly native: StudioResources;
  private readonly modelCheck: CheckModel;
  constructor(service: StudioService, native: StudioResources, modelCheck: CheckModel) {
    this.service = service;
    this.native = native;
    this.modelCheck = modelCheck;
  }
  async call(run: PreparedRun, name: string, args: Record<string, unknown>): Promise<unknown> {
    const scope = await this.service.serialize(async () => {
      const store = await this.service.load();
      await assertAdministrationScope(store, run);
      if (name === 'list_team_imports')
        return { folder: store.folder, reports: await listImports(store) };
      const imported = await readImport(store, stableId(args.packageId));
      const team = store
        .agentCatalog()
        .teams.find((team) => team.id === imported.state.report.teamId)!;
      const agents = team.agentIds.flatMap(
        (id) => store.agentCatalog().agents.find((agent) => agent.id === id) ?? [],
      );
      if (name === 'enable_team_import_builtins') {
        if (!isSetupAssistantRun(store, run)) throw Error(t('builtin.assignmentDisabled'));
        const ids = new Set(Object.values(imported.state.agentMap));
        const builtins = builtinResources.map(({ id }) => id);
        const updates = new Map(
          agents
            .filter((agent) => ids.has(agent.id) && builtins.some((id) => !agent.mcps.includes(id)))
            .map((agent) => [
              agent.id,
              { ...agent, mcps: [...new Set([...agent.mcps, ...builtins])] },
            ]),
        );
        if (updates.size)
          await store.saveSection(
            'agents',
            store.agentCatalog().agents.map((agent) => updates.get(agent.id) ?? agent),
          );
        return { updatedAgentIds: [...updates.keys()] };
      }
      return {
        folder: store.folder,
        ...imported,
        agents,
        resources: store.bootstrap().sections.resources as Resource[],
      };
    });
    if ('reports' in scope) return scope.reports;
    if ('updatedAgentIds' in scope) return { updatedAgentIds: scope.updatedAgentIds };
    if (name === 'read_team_import') {
      scope.state.report.handoff = 'sent';
      if (scope.state.report.mcpHandoff) scope.state.report.mcpHandoff = 'sent';
      await this.persist(scope.folder, scope.state);
      return settingsOutput(
        {
          manifest: scope.data.manifest,
          report: scope.state.report,
          agentMap: scope.state.agentMap,
          resourceMap: scope.state.resourceMap,
          files: scope.data.files.map(({ path, sha256, executable, data }) => ({
            path,
            sha256,
            executable,
            bytes: Buffer.from(data, 'base64').length,
          })),
        },
        args,
        { tool: 'read_team_import', target: { packageId: args.packageId } },
      );
    }
    if (name === 'read_team_import_file') {
      const file = scope.data.files.find((file) => file.path === args.path);
      if (!file) throw new Error(t('error.teamImportTools.theFileIsMissingFrom'));
      const offset = args.offset ?? 0,
        limit = args.limit ?? 32768;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(limit) ||
        Number(offset) < 0 ||
        Number(limit) < 1 ||
        Number(limit) > 65536
      )
        throw new Error(t('error.teamImportTools.invalidPackageReadingRange'));
      const bytes = Buffer.from(file.data, 'base64'),
        part = bytes.subarray(Number(offset), Number(offset) + Number(limit));
      return {
        path: file.path,
        sha256: file.sha256,
        totalBytes: bytes.length,
        offset,
        base64: part.toString('base64'),
        utf8: part.toString('utf8'),
      };
    }
    if (name === 'restore_team_import_resource') {
      const id = stableId(args.resourceId),
        portable = scope.data.manifest.resources.find(
          (resource) => scope.state.resourceMap[resource.id] === id,
        );
      const current = scope.resources.find((resource) => resource.id === id);
      if (!portable || !current)
        throw new Error(t('error.teamImportTools.theResourceDoesNotBelong'));
      if (
        current.kind !== portable.kind ||
        (portable.filesRoot && current.source !== join(scope.root, portable.filesRoot)) ||
        (current.kind === 'plugins' && !portable.filesRoot && current.source !== portable.source)
      )
        throw new Error(t('error.teamImportTools.resourceSettingsChangedAfterImport'));
      if (current.kind === 'mcps') {
        return this.native.configureMcp(scope.folder, {
          ...importedMcpConfig(current, portable),
          displayName: current.name,
        });
      }
      if (current.kind === 'plugins') {
        if (
          current.source.startsWith('npm:') &&
          !/@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(current.source)
        )
          throw new Error(t('error.teamImportTools.packageVersionNotPinnedConfirm'));
        return this.native.installPackage(scope.folder, current.source, current.name);
      }
      return this.native.check(id, scope.folder);
    }
    if (name === 'check_team_import') {
      const results = [];
      for (const agent of scope.agents) {
        const issues: string[] = [];
        try {
          await this.service.serialize(async () => {
            const store = await this.service.load();
            if (store.folder !== scope.folder)
              throw new Error(t('registerTeamHandlers.studioFolderChanged'));
            await this.modelCheck(agent, store);
          });
        } catch (error) {
          issues.push(
            error instanceof Error ? error.message : t('error.teamImportTools.modelNotChecked'),
          );
        }
        for (const kind of ['skills', 'mcps', 'plugins'] as const)
          for (const id of agent[kind]) {
            if (
              builtinResource(id) ||
              agent.capabilitySettings?.[`${kind}:${id}`]?.enabled === false
            )
              continue;
            try {
              const check = await this.native.check(id, scope.folder);
              if (check.status !== 'available')
                issues.push(
                  t('error.teamImportTools.resource', {
                    value1: id,
                    value2: check.status,
                  }),
                );
            } catch (error) {
              issues.push(
                error instanceof Error
                  ? error.message
                  : t('error.teamImportTools.resourceNotChecked'),
              );
            }
          }
        results.push({ agentId: agent.id, name: agent.name, issues });
      }
      for (const previous of scope.state.report.agents)
        if (!scope.agents.some((agent) => agent.id === previous.agentId))
          results.push({
            agentId: previous.agentId,
            name: previous.name,
            issues: [t('error.teamImportTools.theProfileWasRemovedFrom')],
          });
      await this.service.serialize(async () => {
        const store = await this.service.load();
        if (
          store.folder !== scope.folder ||
          JSON.stringify(store.teamProfiles(scope.state.report.teamId)) !==
            JSON.stringify(scope.agents)
        )
          throw new Error(t('error.teamImportTools.teamSettingsChangedDuringVerificatio'));
      });
      scope.state.report.agents = results;
      await this.persist(scope.folder, scope.state);
      return {
        report: scope.state.report,
        configurationChecked: results.every((agent) => !agent.issues.length),
        productionAgentsLaunched: false,
        resourcesLoadedInProductionSession: false,
      };
    }
    throw new Error(t('error.teamImportTools.unknownImportOperation'));
  }
  private async persist(folder: string, state: ImportedTeamState) {
    await this.service.serialize(async () => {
      const store = await this.service.load();
      if (store.folder !== folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
      const current = await readImport(store, state.report.id);
      if (current.state.report.teamId !== state.report.teamId)
        throw new Error(t('error.teamImportTools.theImportedTeamChanged'));
      await atomicJson(join(current.root, 'state.json'), {
        ...state,
        report: {
          ...state.report,
          handoff: current.state.report.handoff === 'sent' ? 'sent' : state.report.handoff,
          ...(current.state.report.mcpHandoff === 'sent' ? { mcpHandoff: 'sent' } : {}),
          ...(current.state.report.mcpReady === undefined
            ? {}
            : { mcpReady: current.state.report.mcpReady }),
        },
      });
    });
  }
}
