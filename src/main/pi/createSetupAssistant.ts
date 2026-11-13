import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { readPiCatalog } from './catalog.ts';
import { getProviderStatus } from './provider.ts';
import { SetupAdministration } from './SetupAdministration.ts';
import { setupTools } from './setupTools.ts';
import { atomicJson, readJson, isMissing, safePath } from '../storage/files.ts';
import { parseProject, snapshotAgent } from '../storage/validation.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Resource } from '../../shared/resources.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import type { SessionBinding } from '../../shared/project.ts';
import type { openSessionTerminal } from './terminal.ts';
import { StudioResources } from './StudioResources.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  headless?: boolean;
  openTerminal?: typeof openSessionTerminal;
  resources?: StudioResources;
}
export function createSetupAssistant(service: StudioService, options: Options) {
  const catalog = async () => {
    const location = await service.serialize(async () => {
      const store = await service.load();
      return {
        folder: store.folder,
        piPath: String(store.bootstrap().sections.piPath ?? '') || options.piPath(),
      };
    });
    return readPiCatalog(location.piPath, options.catalog, location.folder);
  };
  const administration = new SetupAdministration(
    service,
    catalog,
    options.resources ??
      new StudioResources(service, {
        script: join(dirname(options.catalog), 'resources.mjs'),
        logins: join(options.bootstraps, 'resource-logins'),
        piPath: options.piPath,
      }),
  );
  return new RunHost({
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    serviceAgent: true,
    headless: options.headless,
    openTerminal: options.openTerminal,
    tools: setupTools,
    prepare: (request) =>
      service.serialize(async () => {
        if (
          request.projectId !== 'pi-setup-assistant' ||
          request.firstMessage !== undefined ||
          request.autoContinue
        )
          throw new Error('Некорректное открытие помощника.');
        const store = await service.load();
        const sections = store.bootstrap().sections;
        const agent = (sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === 'assistant',
        );
        if (!agent || request.agentId !== agent.id)
          throw new Error('Системный помощник не найден.');
        if (!agent.enabled)
          throw new Error('Системный помощник выключен. Включите его в конструкторе.');
        const path = String(sections.piPath ?? '') || options.piPath();
        const model = agent.model;
        const connections = (sections.connections ?? []) as {
          id: string;
          providerId: string;
          purpose: string;
        }[];
        if (
          !model?.id ||
          !model.provider ||
          !model.connectionId ||
          !connections.some(
            (connection) =>
              connection.id === model.connectionId &&
              connection.providerId === model.provider &&
              connection.purpose !== 'images',
          )
        )
          throw new Error(
            'Выберите подключение и модель системного помощника на странице «Агенты».',
          );
        const models = await readPiCatalog(path, options.catalog, store.folder);
        if (!models.models.some((item) => item.provider === model.provider && item.id === model.id))
          throw new Error(
            'Выбранная модель помощника отсутствует в каталоге Pi. Автоматической подмены нет.',
          );
        if ((await getProviderStatus(path, model.provider)).status !== 'ready')
          throw new Error(
            'Завершите вход в выбранный аккаунт Pi. Модель помощника не подменялась.',
          );
        const root = await safePath(store.folder, '.pistudio/setup-assistant', true);
        await mkdir(root, { recursive: true });
        let session: SessionBinding | undefined;
        let outputPath = snapshotAgent(agent).outputPath;
        try {
          const state = (await readJson(join(root, 'state.json'))) as {
            schemaVersion?: number;
            session?: SessionBinding;
            outputPath?: string;
          };
          if (state.schemaVersion !== 1)
            throw new Error('Неподдерживаемая версия истории помощника.');
          session = state.session;
          if (state.outputPath) outputPath = state.outputPath;
          else if (session && /^agents\/[a-zA-Z0-9_-]+\/sessions\/.+\.jsonl$/.test(session.path))
            outputPath = session.path.split('/').slice(0, 2).join('/') + '/output';
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        const {
          instructions: _blocks,
          mainInstruction: _main,
          systemRole: _role,
          ...profile
        } = agent;
        const project = parseProject({
          schemaVersion: 1,
          id: 'pi-setup-assistant',
          name: agent.name,
          createdAt: 0,
          agents: [{ profile, outputPath, ...(session ? { session } : {}) }],
        });
        for (const sub of ['output', 'sessions'])
          await mkdir(await safePath(root, `${agentDirectory(outputPath)}/${sub}`, true), {
            recursive: true,
          });
        return {
          run: await buildRunContext(
            root,
            project,
            agent.id,
            [agent],
            (sections.resources ?? []) as Resource[],
          ),
          piPath: path,
        };
      }),
    update: async (run, status, session) => {
      if (session) {
        await atomicJson(join(run.projectRoot, 'state.json'), {
          schemaVersion: 1,
          session,
          outputPath: run.agent.outputPath,
        });
        run.agent.session = session;
      }
      run.agent.runStatus = status;
      return { ...run.project, agents: [run.agent] };
    },
    read: async (run) => ({ ...run.project, agents: [run.agent] }),
    tool: (run, name, args) => administration.call(run, name, args),
  });
}
