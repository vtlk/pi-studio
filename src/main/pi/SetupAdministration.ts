import { randomUUID } from 'node:crypto';
import type { StudioService } from '../storage/StudioStore.ts';
import { parseAgent, stableId } from '../storage/validation.ts';
import { importSkill } from '../storage/skills.ts';
import type { Agent, CapabilityKind } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import type { PiModelCatalog } from '../../shared/models.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { join } from 'node:path';

export class SetupAdministration {
  private readonly service: StudioService;
  private readonly catalog: () => Promise<PiModelCatalog>;
  constructor(service: StudioService, catalog: () => Promise<PiModelCatalog>) {
    this.service = service;
    this.catalog = catalog;
  }
  async call(run: PreparedRun, name: string, args: Record<string, unknown>) {
    const models = await this.catalog();
    return this.service.serialize(async () => {
      const store = await this.service.load();
      if (join(store.folder, '.pistudio/setup-assistant') !== run.projectRoot)
        throw new Error(
          'Этот помощник относится к другой папке студии. Откройте помощника заново.',
        );
      const sections = store.bootstrap().sections;
      const agents = (sections.agents ?? []) as Agent[];
      const resources = (sections.resources ?? []) as Resource[];
      const connections = (sections.connections ?? []) as {
        id: string;
        name: string;
        providerId: string;
        purpose: string;
        endpoint: string;
        account: string;
        createdAt: number;
      }[];
      if (name === 'list_configuration')
        return {
          studio: store.folder,
          agents: agents.map(({ mainInstruction: _text, instructions, ...profile }) => ({
            ...profile,
            instructions: instructions.map(({ content: _content, ...block }) => block),
          })),
          resources,
          connections,
          models,
        };
      if (name === 'register_connection') {
        if (
          typeof args.provider !== 'string' ||
          !models.providers.some((provider) => provider.id === args.provider)
        )
          throw new Error('Провайдер отсутствует в реестре установленного Pi.');
        if (typeof args.name !== 'string' || !args.name.trim())
          throw new Error('Нужно название подключения.');
        const old =
          typeof args.id === 'string'
            ? connections.find((connection) => connection.id === args.id)
            : undefined;
        if (args.id && !old)
          throw new Error('Запрошенное подключение отсутствует; другое не подставляется.');
        const connection = {
          ...(old ?? { id: randomUUID(), createdAt: Date.now(), endpoint: '', account: '' }),
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
        if (typeof args.path !== 'string') throw new Error('Нужен полный путь к skill.');
        const resource = await importSkill(args.path, resources);
        await store.saveSection('resources', [
          resource,
          ...resources.filter((item) => item.id !== resource.id),
        ]);
        return { resource, loadedInAgentSession: false };
      }
      if (name === 'configure_agent') {
        const old =
          typeof args.id === 'string' ? agents.find((agent) => agent.id === args.id) : undefined;
        if (args.id && !old)
          throw new Error('Запрошенный профиль отсутствует; другой агент не подставляется.');
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
        if (!String(draft.name).trim()) throw new Error('Назовите агента.');
        if (args.instructions !== undefined) {
          if (!Array.isArray(args.instructions)) throw new Error('Некорректные инструкции.');
          draft.instructions = args.instructions.map((value) => {
            if (!value || typeof value !== 'object')
              throw new Error('Некорректный блок инструкции.');
            const block = value as Record<string, unknown>;
            return { ...block, id: block.id ?? randomUUID(), enabled: block.enabled ?? true };
          });
        }
        if (args.model !== undefined) {
          if (!args.model || typeof args.model !== 'object')
            throw new Error('Некорректная модель.');
          const model = args.model as Record<string, unknown>;
          if (
            !connections.some(
              (connection) =>
                connection.id === model.connectionId &&
                connection.providerId === model.provider &&
                connection.purpose !== 'images',
            )
          )
            throw new Error(
              'Модель должна использовать существующее подключение этого провайдера.',
            );
          if (
            !models.models.some((item) => item.provider === model.provider && item.id === model.id)
          )
            throw new Error('Модель отсутствует в реестре Pi.');
          draft.model = { ...model, temperature: '' };
        }
        const agent = parseAgent(draft);
        await store.saveSection(
          'agents',
          old ? agents.map((item) => (item.id === agent.id ? agent : item)) : [agent, ...agents],
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
          throw new Error('Укажите ровно все текущие ID без повторов.');
        await store.saveSection(
          'agents',
          args.ids.map((id) => agents.find((agent) => agent.id === id)!),
        );
        return { updated: true, updatedProjectSnapshots: false };
      }
      if (name === 'assign_resource') {
        const agent = agents.find((item) => item.id === stableId(args.agentId));
        if (!agent) throw new Error('Агент отсутствует.');
        if (!['skills', 'mcps', 'plugins'].includes(String(args.kind)))
          throw new Error('Некорректный вид ресурса.');
        const kind = args.kind as CapabilityKind;
        const resource = resources.find(
          (item) => item.id === args.resourceId && item.kind === kind,
        );
        if (!resource) throw new Error('Ресурс отсутствует в каталоге.');
        const updated = {
          ...agent,
          [kind]: agent[kind].includes(resource.id) ? agent[kind] : [...agent[kind], resource.id],
          capabilitySettings: {
            ...agent.capabilitySettings,
            [`${kind}:${resource.id}`]: { enabled: args.enabled !== false },
          },
        };
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
      throw new Error('Административный инструмент недоступен.');
    });
  }
}
