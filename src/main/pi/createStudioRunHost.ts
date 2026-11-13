import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { stableId } from '../storage/validation.ts';
import { getProviderStatus } from './provider.ts';
import { readPiCatalog } from './catalog.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { nextEnabledStage, nextStageMessage } from './stageChain.ts';
import { productionTools } from './RunChannel.ts';
import { libraryTools, libraryTool } from '../library/tools.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import { hasModelConfiguration } from '../../shared/modelConfiguration.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references?: ReferenceFiles;
  images?: ImageGeneration;
  headless?: boolean;
  openTerminal?: typeof openSessionTerminal;
}
export function createStudioRunHost(service: StudioService, options: Options) {
  const host: RunHost = new RunHost({
    tools: (run) => [...productionTools, ...libraryTools, ...(options.images?.tools(run) ?? [])],
    closed: (run) => options.images?.cancel(run),
    capabilities: (run, extensions) => options.images?.runtime(run, extensions),
    tool: (run, name, args) =>
      ['generate_image', 'get_image_operation'].includes(name) && options.images
        ? options.images.tool(run, name, args)
        : libraryTool(service, run, name, args),
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    headless: options.headless,
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
        if (!profile || !hasModelConfiguration(profile.model))
          throw new Error('Выберите подключение, модель и уровень рассуждения проектного агента.');
        const connections = sections.connections as {
          id: string;
          providerId: string;
          purpose: string;
        }[];
        const connection = connections.find((item) => item.id === profile?.model?.connectionId);
        if (
          !connection ||
          connection.purpose === 'images' ||
          connection.providerId !== profile?.model?.provider
        )
          throw new Error(
            'Подключение агента отсутствует или изменено. Выберите действующее подключение и модель в конструкторе.',
          );
        const piPath = String(sections.piPath ?? '') || options.piPath();
        if ((await getProviderStatus(piPath, connection.providerId)).status !== 'ready')
          throw new Error('Войдите в выбранный аккаунт Pi перед запуском.');
        const catalog = await readPiCatalog(piPath, options.catalog, store.folder);
        const selectedModel = catalog.models.find(
          (item) => item.provider === profile.model?.provider && item.id === profile.model.id,
        );
        if (!selectedModel)
          throw new Error(
            'Выбранная модель отсутствует в текущем каталоге Pi. Автоматической подмены нет.',
          );
        if (request.attachments?.length && !options.references)
          throw new Error('Передача референсов недоступна.');
        options.references?.validate(
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        project = await store.projects.applyAgentModel(project.id, request.agentId, profile.model);
        const run = await buildRunContext(
          await store.projects.directory(project.id),
          project,
          request.agentId,
          sections.agents as Agent[],
          sections.resources as Resource[],
        );
        await options.references?.attach(
          run,
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        options.images?.bind(run, store.folder, selectedModel);
        return { run, piPath };
      }),
    update: (run, status, session) =>
      service.serialize(async () => {
        const store = await service.load();
        if ((await store.projects.directory(run.project.id)) !== run.projectRoot)
          throw new Error('Папка студии изменилась во время работы Pi.');
        return store.projects.updateRuntime(run.project.id, run.agent.profile.id, status, session);
      }),
    read: (run) =>
      service.serialize(async () => (await service.load()).projects.read(run.project.id)),
    completed: async (run, outputs, message) => {
      const continueStage = host.continuation(run);
      if (!continueStage) return;
      if (run.agent.profile.requiresSceneApproval)
        throw new Error('Требуется согласование результата человеком.');
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
