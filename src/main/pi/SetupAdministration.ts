import { t } from '../../shared/i18n/index.ts';
import { configureTeam, saveTeamAgent } from './teamAdministration.ts';
import type { TeamImportTools } from '../teams/TeamImportTools.ts';
import { randomUUID } from 'node:crypto';
import type { StudioService } from '../storage/StudioStore.ts';
import { parseAgent, stableId } from '../storage/validation.ts';
import { importSkill } from '../storage/skills.ts';
import type { Agent, CapabilityKind } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import type { PiModelCatalog } from '../../shared/models.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { StudioResources } from './StudioResources.ts';
import type { NativeResourceResult } from './NativeResources.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Connection } from '../../shared/connections.ts';
import { builtinResources, optionalBuiltinMcps } from '../../shared/builtinResources.ts';
import { requiredBuiltinMcpIds } from '../../shared/builtinAssignments.ts';
import { assertAdministrationScope } from './administrationScope.ts';
import {
  endpointProviderId,
  parseModelEndpoint,
  modelEndpointUrl,
} from '../../shared/modelEndpoint.ts';

export class SetupAdministration {
  private readonly service: StudioService;
  private readonly catalog: () => Promise<PiModelCatalog>;
  private readonly native?: StudioResources;
  private readonly teamImports?: TeamImportTools;
  constructor(
    service: StudioService,
    catalog: () => Promise<PiModelCatalog>,
    native?: StudioResources,
    teamImports?: TeamImportTools,
  ) {
    this.service = service;
    this.catalog = catalog;
    this.native = native;
    this.teamImports = teamImports;
  }
  async call(run: PreparedRun, name: string, args: Record<string, unknown>) {
    if (
      [
        'list_team_imports',
        'read_team_import',
        'read_team_import_file',
        'restore_team_import_resource',
        'check_team_import',
      ].includes(name)
    ) {
      if (!this.teamImports)
        throw new Error(t('error.setupAdministration.teamImportToolsUnavailable'));
      return this.teamImports.call(run, name, args);
    }
    const resourceTools = [
      'configure_mcp',
      'import_mcp',
      'install_package',
      'check_resource',
      'authenticate_mcp',
    ];
    let nativeMcp: NativeResourceResult | undefined;
    if (this.native && (resourceTools.includes(name) || name === 'list_configuration')) {
      const folder = await this.service.serialize(async () => {
        const store = await this.service.load();
        await assertAdministrationScope(store, run);
        return store.folder;
      });
      if (name === 'configure_mcp')
        return {
          resource: await this.native.configureMcp(folder, args),
          loadedInAgentSession: false,
        };
      if (name === 'import_mcp') {
        if (typeof args.name !== 'string')
          throw new Error(t('error.setupAdministration.aNativeMcpNameIs'));
        return {
          resource: await this.native.importMcp(
            folder,
            args.name,
            typeof args.displayName === 'string' ? args.displayName : undefined,
          ),
          loadedInAgentSession: false,
        };
      }
      if (name === 'install_package')
        return {
          resource: await this.native.installPackage(
            folder,
            args.source,
            typeof args.name === 'string' ? args.name : undefined,
          ),
          loadedInAgentSession: false,
        };
      if (name === 'check_resource' || name === 'authenticate_mcp') {
        if (typeof args.resourceId !== 'string')
          throw new Error(t('error.setupAdministration.aResourceIdIsRequired'));
        return name === 'check_resource'
          ? this.native.check(args.resourceId, folder)
          : this.native.login(args.resourceId, folder);
      }
      nativeMcp = await this.native.listNative(folder);
    }
    const models = await this.catalog();
    return this.service.serialize(async () => {
      const store = await this.service.load();
      await assertAdministrationScope(store, run);
      const sections = store.bootstrap().sections;
      const agents = (sections.agents ?? []) as Agent[];
      const systems = (sections.systemAgents ?? []) as SystemAgent[];
      const resources = (sections.resources ?? []) as Resource[];
      const connections = (sections.connections ?? []) as Connection[];
      if (name === 'list_configuration')
        return {
          studio: store.folder,
          teams: store.agentCatalog().teams,
          agents: agents.map(({ mainInstruction: _text, instructions, ...profile }) => ({
            ...profile,
            instructions: instructions.map(({ content: _content, ...block }) => block),
          })),
          systemAgents: systems.map(({ mainInstruction: _text, instructions, ...profile }) => ({
            ...profile,
            instructions: instructions.map(({ content: _content, ...block }) => block),
            deletable: false,
            builtinMcp: 'pinned',
          })),
          resources: [...resources, ...builtinResources],
          connections,
          models,
          ...(nativeMcp ? { nativeMcp } : {}),
        };
      if (name === 'register_model_endpoint') {
        const old =
          typeof args.id === 'string' ? connections.find((item) => item.id === args.id) : undefined;
        if (args.id && !old) throw new Error(t('error.setupAdministration.connectionMissing'));
        if (old && !['compatible', 'local'].includes(old.purpose))
          throw new Error(t('error.setupAdministration.selectAModelServerConnection'));
        if (
          typeof args.name !== 'string' ||
          !args.name.trim() ||
          !['compatible', 'local'].includes(String(args.purpose)) ||
          typeof args.endpoint !== 'string'
        )
          throw new Error(t('error.setupAdministration.specifyAServerNameType'));
        const id = old?.id ?? randomUUID();
        const connection: Connection = {
          id,
          name: args.name.trim(),
          purpose: args.purpose as 'compatible' | 'local',
          providerId: endpointProviderId(id),
          authScope: 'connection',
          endpoint: modelEndpointUrl(args.endpoint),
          endpointConfig: parseModelEndpoint(args.endpointConfig),
          account: '',
          createdAt: old?.createdAt ?? Date.now(),
        };
        await store.saveSection('connections', [
          connection,
          ...connections.filter((item) => item.id !== id),
        ]);
        return {
          connection,
          authorization: 'not_checked',
          next: 'User configures any required API key in Studio. Never request keys in chat.',
        };
      }
      if (name === 'register_connection') {
        if (
          typeof args.provider !== 'string' ||
          !models.providers.some((provider) => provider.id === args.provider)
        )
          throw new Error(t('error.setupAdministration.theProviderIsMissingFrom'));
        if (typeof args.name !== 'string' || !args.name.trim())
          throw new Error(t('error.setupAdministration.aConnectionNameIsRequired'));
        const old =
          typeof args.id === 'string'
            ? connections.find((connection) => connection.id === args.id)
            : undefined;
        if (args.id && !old)
          throw new Error(t('error.setupAdministration.theRequestedConnectionIsMissing'));
        const connection: Connection = {
          ...(old ?? {
            id: randomUUID(),
            createdAt: Date.now(),
            endpoint: '',
            account: '',
            authScope: 'connection',
          }),
          name: args.name.trim(),
          providerId: args.provider,
          purpose: args.provider === 'openai-codex' ? 'codex' : 'pi',
        };
        await store.saveSection('connections', [
          connection,
          ...connections.filter((item) => item.id !== connection.id),
        ]);
        return { connection, authorization: 'not_checked' };
      }
      if (name === 'import_skill') {
        if (typeof args.path !== 'string')
          throw new Error(t('error.setupAdministration.aFullSkillPathIs'));
        const resource = await importSkill(args.path, resources);
        await store.saveSection('resources', [
          resource,
          ...resources.filter((item) => item.id !== resource.id),
        ]);
        return { resource, loadedInAgentSession: false };
      }
      if (name === 'configure_team') return configureTeam(store, args);
      if (name === 'configure_agent') {
        const old =
          typeof args.id === 'string'
            ? [...agents, ...systems].find((agent) => agent.id === args.id)
            : undefined;
        const system = systems.find((agent) => agent.id === old?.id);
        if (args.id && !old)
          throw new Error(t('error.setupAdministration.theRequestedProfileIsMissing'));
        const draft: Record<string, unknown> = {
          ...(old ?? {
            id: randomUUID(),
            name: '',
            enabled: true,
            instructions: [],
            skills: [],
            mcps: [],
            plugins: [],
          }),
        };
        for (const key of ['name', 'enabled', 'mainInstruction'] as const)
          if (args[key] !== undefined) draft[key] = args[key];
        if (!String(draft.name).trim())
          throw new Error(t('error.setupAdministration.nameTheAgent'));
        if (args.instructions !== undefined) {
          if (!Array.isArray(args.instructions))
            throw new Error(t('error.setupAdministration.invalidInstructions'));
          draft.instructions = args.instructions.map((value) => {
            if (!value || typeof value !== 'object')
              throw new Error(t('error.setupAdministration.invalidInstructionBlock'));
            const block = value as Record<string, unknown>;
            return { ...block, id: block.id ?? randomUUID(), enabled: block.enabled ?? true };
          });
        }
        if (args.model !== undefined) {
          if (!args.model || typeof args.model !== 'object')
            throw new Error(t('error.setupAdministration.invalidModel'));
          const model = args.model as Record<string, unknown>;
          if (
            !connections.some(
              (connection) =>
                connection.id === model.connectionId &&
                connection.providerId === model.provider &&
                connection.purpose !== 'images',
            )
          )
            throw new Error(t('error.setupAdministration.theModelMustUseAn'));
          if (
            !models.models.some(
              (item) => item.provider === model.provider && item.id === model.id,
            ) &&
            !connections.some(
              (item) =>
                item.id === model.connectionId &&
                item.providerId === model.provider &&
                item.endpointConfig?.models.some((entry) => entry.id === model.id),
            )
          )
            throw new Error(t('error.setupAdministration.theModelIsMissingFrom'));
          draft.model = { ...model, temperature: '' };
        }
        const agent = parseAgent(draft);
        if (system)
          await store.saveSection(
            'systemAgents',
            systems.map((item) =>
              item.id === agent.id ? { ...agent, systemRole: system.systemRole } : item,
            ),
          );
        else
          await saveTeamAgent(
            store,
            agent,
            typeof args.teamId === 'string' ? args.teamId : undefined,
          );
        return { agentId: agent.id, name: agent.name, updatedProjectSnapshots: false };
      }
      if (name === 'reorder_agents') {
        if (
          !Array.isArray(args.ids) ||
          args.ids.length !== agents.length ||
          new Set(args.ids).size !== agents.length ||
          args.ids.some((id) => !agents.some((agent) => agent.id === id))
        )
          throw new Error(t('error.setupAdministration.provideExactlyAllCurrentIds'));
        await store.saveSection(
          'agents',
          args.ids.map((id) => agents.find((agent) => agent.id === id)!),
        );
        return { updated: true, updatedProjectSnapshots: false };
      }
      if (name === 'assign_resource') {
        const agent = [...agents, ...systems].find((item) => item.id === stableId(args.agentId));
        if (!agent) throw new Error(t('error.setupAdministration.agentMissing'));
        if (!['skills', 'mcps', 'plugins'].includes(String(args.kind)))
          throw new Error(t('error.setupAdministration.invalidResourceKind'));
        const kind = args.kind as CapabilityKind;
        if (
          kind === 'mcps' &&
          args.enabled === false &&
          requiredBuiltinMcpIds(agent).includes(String(args.resourceId))
        )
          throw new Error(t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved'));
        const resource = [...resources, ...optionalBuiltinMcps].find(
          (item) => item.id === args.resourceId && item.kind === kind,
        );
        if (!resource)
          throw new Error(t('error.setupAdministration.resourceMissingFromTheCatalog'));
        const updated = {
          ...agent,
          [kind]: agent[kind].includes(resource.id) ? agent[kind] : [...agent[kind], resource.id],
          capabilitySettings: {
            ...agent.capabilitySettings,
            [`${kind}:${resource.id}`]: { enabled: args.enabled !== false },
          },
        };
        const system = systems.find((item) => item.id === agent.id);
        if (system)
          await store.saveSection(
            'systemAgents',
            systems.map((item) =>
              item.id === agent.id ? { ...updated, systemRole: system.systemRole } : item,
            ),
          );
        else
          await store.saveSection(
            'agents',
            agents.map((item) => (item.id === agent.id ? updated : item)),
          );
        return {
          agentId: agent.id,
          resourceId: resource.id,
          enabled: args.enabled !== false,
          updatedProjectSnapshots: false,
          loadedInAgentSession: false,
        };
      }
      throw new Error(t('error.setupAdministration.administrativeToolUnavailable'));
    });
  }
}
