import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { stableId } from '../storage/validation.ts';
import { getProviderStatus } from './provider.ts';
import { readPiCatalog } from './catalog.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { nextEnabledStage, nextStageMessage } from './stageChain.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
}
export function createStudioRunHost(service: StudioService, options: Options) {
  const host: RunHost = new RunHost({
    bootstraps: options.bootstraps,
    bridge: options.bridge,
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
        const project = await store.projects.read(request.projectId);
        const profile = project.agents.find((item) => item.profile.id === request.agentId)?.profile;
        if (!profile?.model) throw new Error('Выберите модель проектного агента.');
        const sections = store.bootstrap().sections;
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
            'Подключение проектного агента отсутствует или изменено. Настройте модель и явно перечитайте профиль.',
          );
        const piPath = String(sections.piPath ?? '') || options.piPath();
        if ((await getProviderStatus(piPath, connection.providerId)).status !== 'ready')
          throw new Error('Войдите в выбранный аккаунт Pi перед запуском.');
        const catalog = await readPiCatalog(piPath, options.catalog);
        if (
          !catalog.models.some(
            (item) => item.provider === profile.model?.provider && item.id === profile.model.id,
          )
        )
          throw new Error(
            'Выбранная модель отсутствует в текущем каталоге Pi. Автоматической подмены нет.',
          );
        const run = await buildRunContext(
          await store.projects.directory(project.id),
          project,
          request.agentId,
          sections.agents as Agent[],
          sections.resources as Resource[],
        );
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
      if (run.agent.profile.requiresSceneApproval)
        throw new Error('Требуется согласование результата человеком.');
      const project = await service.serialize(async () =>
        (await service.load()).projects.read(run.project.id),
      );
      const next = nextEnabledStage(project, run.agent.profile.id);
      if (!next) return;
      const input = nextStageMessage(run, outputs, message);
      await host.launch(
        {
          projectId: project.id,
          agentId: next.profile.id,
          autoContinue: true,
          ...(!next.session ? { firstMessage: input } : {}),
        },
        next.session ? input : undefined,
      );
    },
  });
  return host;
}
