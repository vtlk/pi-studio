import type { PreviewRenderer } from '../library/previewOptions.ts';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryKind } from '../../shared/library.ts';
import type { Agent } from '../../shared/studio.ts';
import { hasLibraryMcp } from '../../shared/builtinResources.ts';
import type { Resource } from '../../shared/resources.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { parseProject, snapshotAgent } from '../storage/validation.ts';
import { safePath, atomicJson } from '../storage/files.ts';
import { libraryTools, libraryTool } from '../library/tools.ts';
import { libraryKind } from '../library/manifest.ts';
import { RunHost } from './RunHost.ts';
import { productionTools } from './RunChannel.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { Connection } from '../../shared/connections.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references: ReferenceFiles;
  images?: ImageGeneration;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
  libraryPreview?: PreviewRenderer;
  mcpSecrets?: McpSecrets;
  headless?: boolean;
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
}
export function createLibraryRunHost(service: StudioService, options: Options) {
  const requests = new Map<
    string,
    { kind: LibraryKind; agentId: string; description: string; attachments: string[] }
  >();
  const host = new RunHost({
    ...options,
    serviceAgent: true,
    mcpGroups: (run) => options.computer?.groups(run) ?? [],
    tools: (run) => [
      ...productionTools,
      ...(run.libraryAccess
        ? libraryTools.filter(
            (tool) => tool.name !== 'library_render_preview' || !!options.libraryPreview,
          )
        : []),
      ...(options.images?.tools(run) ?? []),
    ],
    closed: (run) => {
      options.images?.cancel(run);
      options.browser?.release(run);
      options.computer?.release(run);
    },
    capabilities: (run, extensions) => options.images?.runtime(run, extensions),
    runtimeCapabilities: (run) => ({
      imageGeneration: options.images?.availability(run) ?? {
        available: false,
        reason: 'not-initialized',
      },
    }),
    tool: (run, name, args) =>
      ['generate_image', 'get_image_operation'].includes(name) && options.images
        ? options.images.tool(run, name, args)
        : libraryTool(service, run, name, args, 'library-service', options.libraryPreview),
    prepare: (request) =>
      service.serialize(async () => {
        const input = requests.get(request.projectId);
        if (!input || request.autoContinue || request.firstMessage !== input.description)
          throw new Error('Некорректный запуск библиотечного агента.');
        const store = await service.load();
        const sections = store.bootstrap().sections;
        const agent = (sections.agents as Agent[]).find((agent) => agent.id === input.agentId);
        if (!agent || agent.id !== request.agentId || !agent.enabled || !hasLibraryMcp(agent))
          throw new Error(
            'Выбранный агент отсутствует, выключен или не имеет библиотечного MCP. Выберите агента в форме библиотеки.',
          );
        const path = String(sections.piPath ?? '') || options.piPath();
        const {
          selectedModel: selected,
          modelAuth,
          thinkingLevel,
        } = await resolveAgentLaunchConfig(
          agent.model,
          (sections.connections ?? []) as Connection[],
          { ...options, folder: store.folder, piPath: path },
        );
        options.references.validate(input.attachments, store.folder, selected.imageInput);
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
          thinkingLevel,
        );
        run.libraryKind = input.kind;
        await options.references.attach(run, input.attachments, store.folder, selected.imageInput);
        options.images?.bind(run, store.folder, selected);
        await options.browser?.bind(run, store.folder, path, selected.imageInput);
        await atomicJson(join(root, 'state.json'), { schemaVersion: 1, kind: input.kind, project });
        await options.computer?.bind(run, selected.imageInput);
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
          kind: run.libraryKind,
          project: run.project,
        });
        return run.project;
      }),
    read: async (run) => run.project,
  });
  return {
    async create(input: {
      kind: LibraryKind;
      agentId: string;
      description: string;
      attachments: string[];
    }) {
      libraryKind(input?.kind);
      if (
        typeof input.agentId !== 'string' ||
        !input.agentId ||
        typeof input.description !== 'string' ||
        !input.description.trim() ||
        input.description.length > 200_000 ||
        !Array.isArray(input.attachments)
      )
        throw new Error('Введите описание материала и проверьте референсы.');
      const id = randomUUID();
      requests.set(id, input);
      try {
        return await host.launch({
          projectId: id,
          agentId: input.agentId,
          autoContinue: false,
          firstMessage: input.description,
        });
      } finally {
        requests.delete(id);
      }
    },
    drain: () => host.drain(),
    close: () => host.close(),
    assertIdle: () => host.assertIdle(),
  };
}
