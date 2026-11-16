import { ContinuationCancelled } from './RunTypes.ts';
import type { TeamSupport } from '../team-mcp/TeamSupport.ts';
import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { stableId } from '../storage/validation.ts';
import type { Connection } from '../../shared/connections.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { nextEnabledStage, nextStageMessage } from './stageChain.ts';
import { productionTools } from './RunChannel.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ProjectActivity } from './ProjectActivity.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';

interface Options {
  team?: TeamSupport;
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references?: ReferenceFiles;
  images?: ImageGeneration;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
  activity?: ProjectActivity;
  mcpSecrets?: McpSecrets;
  headless?: boolean;
  captureTerminal?: RunDependencies['captureTerminal'];
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
}
export function createStudioRunHost(service: StudioService, options: Options) {
  const host: RunHost = new RunHost({
    mcpGroups: (run) => [
      ...(options.computer?.groups(run) ?? []),
      ...(options.team?.groups(run) ?? []),
    ],
    observed: (run, event) => options.team?.event(run, event) ?? Promise.resolve(),
    tools: (run) => [...productionTools, ...(options.images?.tools(run) ?? [])],
    closed: (run) => {
      options.activity?.set(run, false);
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
    activityChanged: (run, working) => options.activity?.set(run, working),
    accounting: (run, sample) =>
      service.serialize(async () => {
        await (await service.load()).accounting.record(run, sample);
      }),
    accountingLost: (run) =>
      service.serialize(async () => {
        await (await service.load()).accounting.lost(run);
      }),
    tool: (run, name, args) =>
      ['generate_image', 'get_image_operation'].includes(name) && options.images
        ? options.images.tool(run, name, args)
        : Promise.reject(new Error('Неизвестный инструмент проекта.')),
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    headless: options.headless,
    captureTerminal: options.captureTerminal,
    beforeAutomaticClose: (run) => options.images?.assertRunIdle(run),
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
        const { model, selectedModel, modelAuth, thinkingLevel } = await resolveAgentLaunchConfig(
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
          thinkingLevel,
        );
        await options.references?.attach(
          run,
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        options.images?.bind(run, store.folder, selectedModel);
        await options.browser?.bind(run, store.folder, piPath, selectedModel.imageInput);
        await store.accounting.begin(run);
        await options.computer?.bind(run, selectedModel.imageInput);
        run.modelAuth = modelAuth;
        return { run, piPath };
      }),
    update: (run, status, session, failure) =>
      service.serialize(async () => {
        const store = await service.load();
        if ((await store.projects.directory(run.project.id)) !== run.projectRoot)
          throw new Error('Папка студии изменилась во время работы Pi.');
        return store.accounting.enrich(
          await store.projects.updateRuntime(
            run.project.id,
            run.agent.profile.id,
            status,
            session,
            failure,
          ),
        );
      }),
    read: (run) =>
      service.serialize(async () => (await service.load()).projects.read(run.project.id)),
    completed: async (run, outputs, message) => {
      const sequence = run.requestSequence;
      const continueStage = host.continuation(run);
      if (!continueStage) return;
      try {
        const project = await service.serialize(async () =>
          (await service.load()).projects.read(run.project.id),
        );
        const next = nextEnabledStage(project, run.agent.profile.id);
        await host.closeCompleted(run, sequence!, continueStage.check);
        if (!next) {
          continueStage.finish();
          return;
        }
        await continueStage(
          { projectId: project.id, agentId: next.profile.id, autoContinue: true },
          nextStageMessage(run, outputs, message),
        );
      } catch (error) {
        if (error instanceof ContinuationCancelled) return;
        continueStage.pause();
        throw error;
      }
    },
  });
  options.team?.attach(host);
  return host;
}
