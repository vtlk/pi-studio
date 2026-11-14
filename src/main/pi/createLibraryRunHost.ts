import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryKind } from '../../shared/library.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Resource } from '../../shared/resources.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { parseProject, snapshotAgent } from '../storage/validation.ts';
import { safePath, atomicJson } from '../storage/files.ts';
import { libraryTools, libraryTool } from '../library/tools.ts';
import { libraryKind } from '../library/manifest.ts';
import { RunHost } from './RunHost.ts';
import { productionTools } from './RunChannel.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { readPiCatalog } from './catalog.ts';
import { connectionAuthScope, getModelProviderStatus } from './modelAuth.ts';
import type { Connection } from '../../shared/connections.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references: ReferenceFiles;
  images?: ImageGeneration;
  mcpSecrets?: McpSecrets;
  headless?: boolean;
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
}
export function createLibraryRunHost(service: StudioService, options: Options) {
  const requests = new Map<
    string,
    { kind: LibraryKind; description: string; attachments: string[] }
  >();
  const host = new RunHost({
    ...options,
    serviceAgent: true,
    tools: (run) => [...productionTools, ...libraryTools, ...(options.images?.tools(run) ?? [])],
    closed: (run) => options.images?.cancel(run),
    capabilities: (run, extensions) => options.images?.runtime(run, extensions),
    tool: (run, name, args) =>
      ['generate_image', 'get_image_operation'].includes(name) && options.images
        ? options.images.tool(run, name, args)
        : libraryTool(service, run, name, args, 'library-service'),
    prepare: (request) =>
      service.serialize(async () => {
        const input = requests.get(request.projectId);
        if (!input || request.autoContinue || request.firstMessage !== input.description)
          throw new Error('Некорректный запуск библиотечного агента.');
        const store = await service.load();
        const sections = store.bootstrap().sections;
        const role = input.kind === 'characters' ? 'character' : 'location';
        const agent = (sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === role,
        );
        if (!agent || agent.id !== request.agentId || !agent.enabled)
          throw new Error(
            'Библиотечный агент отсутствует или выключен. Включите его в конструкторе.',
          );
        const model = agent.model;
        const connections = (sections.connections ?? []) as Connection[];
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
          throw new Error('Выберите подключение и модель системного агента на странице «Агенты».');
        const path = String(sections.piPath ?? '') || options.piPath();
        const modelAuth = await connectionAuthScope(
          join(dirname(options.bootstraps), 'model-auth'),
          store.folder,
          connections.find((item) => item.id === model.connectionId)!,
        );
        const catalog = await readPiCatalog(path, options.catalog, store.folder, modelAuth);
        const selected = catalog.models.find(
          (item) => item.provider === model.provider && item.id === model.id,
        );
        if (!selected)
          throw new Error('Выбранная модель отсутствует в Pi. Автоматической подмены нет.');
        options.references.validate(input.attachments, store.folder, selected.imageInput);
        if (
          (
            await getModelProviderStatus(
              path,
              join(dirname(options.catalog), 'model-auth.mjs'),
              model.provider,
              modelAuth,
            )
          ).status !== 'ready'
        )
          throw new Error('Войдите в выбранный аккаунт Pi перед запуском.');
        const root = await safePath(
          store.folder,
          `.pistudio/library-runs/${request.projectId}`,
          true,
        );
        await mkdir(root, { recursive: true });
        const snapshot = snapshotAgent(agent);
        // The service role is a binding, not project snapshot data or archived instruction text.
        const { systemRole: _role, ...profile } = snapshot.profile as typeof snapshot.profile & {
          systemRole?: string;
        };
        const project = parseProject({
          schemaVersion: 1,
          id: request.projectId,
          name: agent.name,
          createdAt: Date.now(),
          agents: [{ ...snapshot, profile }],
        });
        for (const sub of ['output', 'sessions'])
          await mkdir(await safePath(root, `${agentDirectory(snapshot.outputPath)}/${sub}`, true), {
            recursive: true,
          });
        const run = await buildRunContext(
          root,
          project,
          agent.id,
          [agent],
          (sections.resources ?? []) as Resource[],
          options.mcpSecrets?.resolver(store.folder, path),
        );
        await options.references.attach(run, input.attachments, store.folder, selected.imageInput);
        options.images?.bind(run, store.folder, selected);
        await atomicJson(join(root, 'state.json'), { schemaVersion: 1, kind: input.kind, project });
        run.modelAuth = modelAuth;
        return { run, piPath: path };
      }),
    update: (run, status, session, failure) =>
      service.serialize(async () => {
        const store = await service.load();
        if (
          (await safePath(store.folder, `.pistudio/library-runs/${run.project.id}`)) !==
          run.projectRoot
        )
          throw new Error('Папка студии изменилась.');
        run.agent.runStatus = status;
        run.agent.runFailure = status === 'error' ? (failure ?? run.agent.runFailure) : undefined;
        if (session) run.agent.session = session;
        await atomicJson(join(run.projectRoot, 'state.json'), {
          schemaVersion: 1,
          kind:
            run.project.agents[0].profile.id ===
            (store.bootstrap().sections.systemAgents as SystemAgent[]).find(
              (agent) => agent.systemRole === 'character',
            )?.id
              ? 'characters'
              : 'locations',
          project: run.project,
        });
        return run.project;
      }),
    read: async (run) => run.project,
  });
  return {
    async create(input: { kind: LibraryKind; description: string; attachments: string[] }) {
      libraryKind(input?.kind);
      if (
        typeof input.description !== 'string' ||
        !input.description.trim() ||
        input.description.length > 200_000 ||
        !Array.isArray(input.attachments)
      )
        throw new Error('Введите описание материала и проверьте референсы.');
      const id = randomUUID();
      const agentId = await service.serialize(
        async () =>
          ((await service.load()).bootstrap().sections.systemAgents as SystemAgent[]).find(
            (agent) =>
              agent.systemRole === (input.kind === 'characters' ? 'character' : 'location'),
          )!.id,
      );
      requests.set(id, input);
      try {
        return await host.launch({
          projectId: id,
          agentId,
          autoContinue: false,
          firstMessage: input.description,
        });
      } finally {
        requests.delete(id);
      }
    },
    close: () => host.close(),
    assertIdle: () => host.assertIdle(),
  };
}
