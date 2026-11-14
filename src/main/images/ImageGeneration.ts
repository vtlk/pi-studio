import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { StudioService } from '../storage/StudioStore.ts';
import { safePath } from '../storage/files.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { PiModelSummary } from '../../shared/models.ts';
import type { ImageConnections } from './ImageConnections.ts';
import { imageParameters, ImagesApiError } from './ImagesApi.ts';
import { ImageOperations, type ImageOperation } from './ImageOperations.ts';
import { imageTools } from './tools.ts';
import { readImageReferences } from './imageReferences.ts';

interface Binding {
  folder: string;
  eligible: boolean;
  adapterConfirmed: boolean;
  closed: boolean;
  scope: string;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class ImageGeneration {
  private service: StudioService;
  private connections: ImageConnections;
  private bindings = new WeakMap<PreparedRun, Binding>();
  private busy = new Set<string>();
  private requests = new Map<PreparedRun, AbortController>();
  private operations: ImageOperations;
  constructor(service: StudioService, connections: ImageConnections, directory: string) {
    this.service = service;
    this.connections = connections;
    this.operations = new ImageOperations(directory);
  }
  assertIdle(projectId?: string) {
    if ([...this.requests.keys()].some((run) => !projectId || run.project.id === projectId))
      throw new Error(
        'Дождитесь окончания операции изображения перед изменением папки проекта или студии.',
      );
  }
  bind(run: PreparedRun, folder: string, model: PiModelSummary) {
    // Pi 1.5.2's Codex chat adapter plus this bundled bridge inject only hosted web search.
    // Assigned executable extensions can alter capabilities; those sessions stay unknown.
    const adapterConfirmed =
      model.provider === 'openai-codex' && model.api === 'openai-codex-responses';
    this.bindings.set(run, {
      folder,
      adapterConfirmed,
      eligible: adapterConfirmed && run.resources.plugins.length === 0,
      closed: false,
      scope: `${folder}\0${run.project.id}\0${run.agent.profile.id}`,
    });
  }
  runtime(run: PreparedRun, executableExtensions: boolean) {
    const binding = this.bindings.get(run);
    if (binding) binding.eligible = binding.adapterConfirmed && !executableExtensions;
  }
  tools(run: PreparedRun) {
    const binding = this.bindings.get(run);
    return binding?.eligible && !binding.closed ? imageTools : [];
  }
  cancel(run: PreparedRun) {
    const binding = this.bindings.get(run);
    if (binding) binding.closed = true;
    this.requests.get(run)?.abort();
  }
  private binding(run: PreparedRun) {
    const binding = this.bindings.get(run);
    if (!binding?.eligible || binding.closed)
      throw new Error(
        'Генерация изображений недоступна этой сессии: возможности не подтверждены или Pi закрыт.',
      );
    return binding;
  }
  async tool(run: PreparedRun, name: string, args: Record<string, unknown>) {
    const binding = this.binding(run);
    if (name === 'get_image_operation') {
      const operation = (await this.operations.read(binding.scope)).find(
        (item) => item.id === args.operationId,
      );
      if (!operation) throw new Error('Операция отсутствует у этого проектного агента.');
      return operation;
    }
    if (name !== 'generate_image') throw new Error('Неизвестный инструмент изображений.');
    if (!run.requestSequence)
      throw new Error('Дождитесь нового пользовательского запроса в Pi перед генерацией.');
    if (this.busy.has(binding.scope))
      throw new Error('Операция изображения этого агента уже выполняется. Дождитесь результата.');
    const parameters = imageParameters(args);
    const requestId = `${run.record.runId}:${run.requestSequence}`;
    this.busy.add(binding.scope);
    let operation: ImageOperation | undefined;
    let credentialRevision = '';
    const operations = await this.operations.read(binding.scope).catch((error) => {
      this.busy.delete(binding.scope);
      throw error;
    });
    const controller = new AbortController();
    this.requests.set(run, controller);
    try {
      const configuration = await this.service.serialize(async () => {
        const store = await this.service.load();
        if (store.folder !== binding.folder) throw new Error('Папка студии изменилась.');
        const settings = store.bootstrap().sections.imageTool as
          { connectionId?: string; modelId?: string } | undefined;
        if (!settings?.connectionId || !settings.modelId)
          throw new Error('Настройте общее подключение и модель Images API в настройках студии.');
        if (!/^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(settings.modelId))
          throw new Error('Выберите модель GPT Image в общих настройках инструмента.');
        return { connectionId: settings.connectionId, modelId: settings.modelId };
      });
      const references = await readImageReferences(run.projectRoot, args.references);
      const requestHash = hash(
        JSON.stringify({
          ...configuration,
          ...parameters,
          ...(references.length ? { references: references.map((image) => image.sha256) } : {}),
        }),
      );
      const unresolved = operations.find(
        (item) =>
          item.requestId === requestId &&
          ['pending', 'uncertain', 'save_failed'].includes(item.state),
      );
      if (unresolved)
        throw new Error(
          `Операция ${unresolved.id}: результат ${unresolved.state}. Запрос мог быть оплачен. Дождитесь нового обращения пользователя перед повтором или другой генерацией.`,
        );
      const previous = [...operations].reverse().find((item) => item.requestHash === requestHash);
      if (args.retryOperationId && previous?.id !== args.retryOperationId)
        throw new Error(
          'Повтор относится к другой или отсутствующей операции. Запрос не отправлен.',
        );
      if (
        previous &&
        ['pending', 'uncertain', 'save_failed'].includes(previous.state) &&
        !(args.retryOperationId === previous.id && previous.requestId !== requestId)
      )
        throw new Error(
          `Операция ${previous.id}: результат ${previous.state}. Запрос мог быть оплачен. Прочитайте get_image_operation и спросите пользователя перед новым платным повтором.`,
        );
      if (previous?.requestId === requestId && previous.state === 'saved') {
        if (
          !previous.path ||
          hash(await readFile(await safePath(run.projectRoot, previous.path))) !== previous.sha256
        )
          throw new Error(
            `Результат операции ${previous.id} изменён или удалён. Автоматической повторной генерации нет.`,
          );
        return {
          operationId: previous.id,
          path: previous.path.split('/').at(-1),
          projectPath: previous.path,
          mimeType: 'image/png',
          usage: previous.usage,
          reused: true,
        };
      }
      if (previous?.requestId === requestId && previous.state === 'failed')
        throw new Error(
          `Операция ${previous.id} отклонена API. Исправьте подключение/параметры и дайте новый запрос в Pi; автоматического повтора нет.`,
        );
      const authorization = await this.connections.authorization({
        folder: binding.folder,
        connectionId: configuration.connectionId,
      });
      credentialRevision = authorization.revision;
      await safePath(run.projectRoot, run.agent.outputPath);
      this.binding(run);
      operation = {
        id: randomUUID(),
        requestId,
        requestHash,
        createdAt: Date.now(),
        ...configuration,
        ...(references.length ? { referenceHashes: references.map((image) => image.sha256) } : {}),
        state: 'pending',
      };
      operations.push(operation);
      await this.operations.save(binding.scope, operations);
      const generated = await this.connections.api.generate(
        authorization.key,
        configuration.modelId,
        parameters,
        controller.signal,
        references,
      );
      await this.connections
        .reportAuthorization(
          { folder: binding.folder, connectionId: configuration.connectionId },
          credentialRevision,
          true,
          configuration.modelId,
        )
        .catch(() => {});
      operation.state = 'save_failed';
      const filename = `image-${operation.id}.png`,
        path = `${run.agent.outputPath}/${filename}`;
      const file = await open(
        await safePath(run.projectRoot, path, true),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(generated.bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      operation.state = 'saved';
      operation.path = path;
      operation.sha256 = hash(generated.bytes);
      operation.usage = generated.usage;
      await this.operations.save(binding.scope, operations);
      return {
        operationId: operation.id,
        path: filename,
        projectPath: path,
        mimeType: 'image/png',
        usage: generated.usage,
      };
    } catch (error) {
      if (operation) {
        if (error instanceof ImagesApiError && ['authentication', 'access'].includes(error.kind))
          await this.connections
            .reportAuthorization(
              { folder: binding.folder, connectionId: operation.connectionId },
              credentialRevision,
              error.kind === 'access' ? 'restricted' : false,
            )
            .catch(() => {});
        operation.reason = error instanceof ImagesApiError ? error.kind : 'saving';
        if (error instanceof ImagesApiError && error.diagnostic)
          operation.diagnostic = error.diagnostic;
        if (operation.state === 'pending')
          operation.state =
            error instanceof ImagesApiError &&
            ['authentication', 'access', 'quota', 'parameters'].includes(error.kind)
              ? 'failed'
              : 'uncertain';
        await this.operations.save(binding.scope, operations).catch(() => {});
        throw new Error(
          `${error instanceof ImagesApiError ? error.message : 'Не удалось завершить операцию изображения. Повтор не выполнен.'} Операция: ${operation.id}; состояние: ${operation.state}.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      this.busy.delete(binding.scope);
      this.requests.delete(run);
    }
  }
}
