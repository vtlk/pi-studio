import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { stableId } from '../storage/validation.ts';
import type { Connection } from '../../shared/connections.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { nextEnabledStage, nextStageMessage } from './stageChain.ts';
import { productionTools } from './RunChannel.ts';
import { libraryTools, libraryTool } from '../library/tools.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references?: ReferenceFiles;
  images?: ImageGeneration;
  mcpSecrets?: McpSecrets;
  headless?: boolean;
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
}
export function createStudioRunHost(service: StudioService, options: Options) {
  const host: RunHost = new RunHost({
    tools: (run) => [
      ...productionTools,
      ...(run.libraryAccess ? libraryTools : []),
      ...(options.images?.tools(run) ?? []),
    ],
    closed: (run) => options.images?.cancel(run),
    capabilities: (run, extensions) => options.images?.runtime(run, extensions),
    tool: (run, name, args) =>
      ['generate_image', 'get_image_operation'].includes(name) && options.images
        ? options.images.tool(run, name, args)
        : libraryTool(service, run, name, args),
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    headless: options.headless,
    failureChanged: options.failureChanged,
    openTerminal: options.openTerminal,
    prepare: (request) =>
      service.serialize(async () => {
        stableId(request.projectId);
        stableId(request.agentId);
        if (
          typeof request.autoContinue !== 'boolean' ||
          (request.firstMessage !== undefined && typeof request.firstMessage !== 'string')
        )
          throw new Error('Некорректный запрос запуска.');
        const store = await service.load();
        let project = await store.projects.read(request.projectId);
        const savedAgent = project.agents.find((item) => item.profile.id === request.agentId);
        if (!savedAgent) throw new Error('Агент отсутствует в проекте.');
        if (!savedAgent.profile.enabled) throw new Error('Агент выключен.');
        const sections = store.bootstrap().sections;
        const current = (sections.agents as Agent[]).find((agent) => agent.id === request.agentId);
        if (!current)
          throw new Error('Профиль агента удалён из конструктора. Другой агент не подставляется.');
        const profile = current;
        if (
          project.agents.find((item) => item.profile.id === request.agentId)?.session &&
          request.attachments?.length
        )
          throw new Error('Продолжение диалога не отправляет референсы повторно.');
        const piPath = String(sections.piPath ?? '') || options.piPath();
        const { model, selectedModel, modelAuth } = await resolveAgentLaunchConfig(
          profile.model,
          sections.connections as Connection[],
          { ...options, folder: store.folder, piPath },
        );
        if (request.attachments?.length && !options.references)
          throw new Error('Передача референсов недоступна.');
        options.references?.validate(
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        project = await store.projects.applyAgentModel(project.id, request.agentId, model);
        const run = await buildRunContext(
          await store.projects.directory(project.id),
          project,
          request.agentId,
          sections.agents as Agent[],
          sections.resources as Resource[],
          options.mcpSecrets?.resolver(store.folder, piPath),
        );
        await options.references?.attach(
          run,
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        options.images?.bind(run, store.folder, selectedModel);
        run.modelAuth = modelAuth;
        return { run, piPath };
      }),
    update: (run, status, session, failure) =>
      service.serialize(async () => {
        const store = await service.load();
        if ((await store.projects.directory(run.project.id)) !== run.projectRoot)
          throw new Error('Папка студии изменилась во время работы Pi.');
        return store.projects.updateRuntime(
          run.project.id,
          run.agent.profile.id,
          status,
          session,
          failure,
        );
      }),
    read: (run) =>
      service.serialize(async () => (await service.load()).projects.read(run.project.id)),
    completed: async (run, outputs, message) => {
      const continueStage = host.continuation(run);
      if (!continueStage) return;
      const project = await service.serialize(async () =>
        (await service.load()).projects.read(run.project.id),
      );
      const next = nextEnabledStage(project, run.agent.profile.id);
      if (!next) return;
      const input = nextStageMessage(run, outputs, message);
      await continueStage(
        {
          projectId: project.id,
          agentId: next.profile.id,
          autoContinue: true,
        },
        input,
      );
    },
  });
  return host;
}
