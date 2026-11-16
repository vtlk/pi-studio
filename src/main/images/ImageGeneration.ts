import { t } from '../../shared/i18n/index.ts';
import { projectAgentOutputPath } from '../../shared/agentPaths.ts';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
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
import { confirmedChatAdapter } from './imageRuntime.ts';

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
      throw new Error(t('error.imageGeneration.waitForTheImageOperation'));
  }
  assertRunIdle(run: PreparedRun) {
    if (this.requests.has(run))
      throw new Error(t('error.imageGeneration.thisAgentSImageOperation'));
  }
  bind(run: PreparedRun, folder: string, model: PiModelSummary) {
    // Unknown protocols and executable extensions keep image capabilities unknown.
    const adapterConfirmed = confirmedChatAdapter(model);
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
  availability(run: PreparedRun) {
    const binding = this.bindings.get(run);
    if (!binding)
      return {
        available: false,
        reason: 'not-initialized',
        explanation: 'The Images API runtime is not initialized for this session.',
      };
    if (binding.closed)
      return {
        available: false,
        reason: 'session-closed',
        explanation: 'This Pi session has closed.',
      };
    if (!binding.adapterConfirmed)
      return {
        available: false,
        reason: 'unconfirmed-adapter',
        explanation:
          'Studio has not confirmed native image-generation capabilities of this chat adapter. This is not an Images API credential error.',
      };
    if (!binding.eligible)
      return {
        available: false,
        reason: 'executable-extensions',
        explanation:
          'Executable Pi extensions may change image capabilities; Studio has not confirmed this runtime. Changing the Images API key does not resolve this restriction.',
      };
    return {
      available: true,
      reason: 'confirmed-chat-adapter',
      explanation:
        'The shared generate_image MCP tool is available. This does not check its saved connection, model or credentials and does not authorize an automatic paid fallback.',
    };
  }
  cancel(run: PreparedRun) {
    const binding = this.bindings.get(run);
    if (binding) binding.closed = true;
    this.requests.get(run)?.abort();
  }
  private binding(run: PreparedRun) {
    const binding = this.bindings.get(run);
    if (!binding?.eligible || binding.closed)
      throw new Error(t('error.imageGeneration.imageGenerationIsUnavailableFor'));
    return binding;
  }
  async tool(run: PreparedRun, name: string, args: Record<string, unknown>) {
    const binding = this.binding(run);
    if (name === 'get_image_operation') {
      const operation = (await this.operations.read(binding.scope)).find(
        (item) => item.id === args.operationId,
      );
      if (!operation) throw new Error(t('error.imageGeneration.thisProjectAgentHasNo'));
      return operation;
    }
    if (name !== 'generate_image') throw new Error(t('error.imageGeneration.unknownImageTool'));
    if (!run.requestSequence) throw new Error(t('error.imageGeneration.waitForANewUser'));
    if (this.busy.has(binding.scope))
      throw new Error(t('error.imageGeneration.thisAgentAlreadyHasAn'));
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
        if (store.folder !== binding.folder)
          throw new Error(t('registerTeamHandlers.studioFolderChanged'));
        const settings = store.bootstrap().sections.imageTool as
          { connectionId?: string; modelId?: string } | undefined;
        if (!settings?.connectionId || !settings.modelId)
          throw new Error(t('error.imageGeneration.configureTheSharedImagesApi'));
        if (!/^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(settings.modelId))
          throw new Error(t('error.imageGeneration.selectAGptImageModel'));
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
          t('error.imageGeneration.operationResultTheRequestMay', {
            value1: unresolved.id,
            value2: unresolved.state,
          }),
        );
      const previous = [...operations].reverse().find((item) => item.requestHash === requestHash);
      if (args.retryOperationId && previous?.id !== args.retryOperationId)
        throw new Error(t('error.imageGeneration.theRetryRefersToA'));
      if (
        previous &&
        ['pending', 'uncertain', 'save_failed'].includes(previous.state) &&
        !(args.retryOperationId === previous.id && previous.requestId !== requestId)
      )
        throw new Error(
          t('error.imageGeneration.operationResultTheRequestMay2', {
            value1: previous.id,
            value2: previous.state,
          }),
        );
      if (previous?.requestId === requestId && previous.state === 'saved') {
        const saved = previous.path
          ? (await readImageReferences(run.projectRoot, [previous.path]).catch(() => []))[0]
          : undefined;
        if (!previous.path || !saved || saved.sha256 !== previous.sha256)
          throw new Error(
            t('error.imageGeneration.theResultOfOperationWas', {
              value1: previous.id,
            }),
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
          t('error.imageGeneration.theApiRejectedOperationFix', {
            value1: previous.id,
          }),
        );
      const authorization = await this.connections.authorization({
        folder: binding.folder,
        connectionId: configuration.connectionId,
      });
      credentialRevision = authorization.revision;
      if (run.project.workspaceMode !== 'shared')
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
        path = [projectAgentOutputPath(run.project, run.agent), filename].filter(Boolean).join('/');
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
          t('error.imageGeneration.operationState', {
            value1:
              error instanceof ImagesApiError
                ? error.message
                : t('error.imageGeneration.couldNotCompleteTheImage'),
            value2: operation.id,
            value3: operation.state,
          }),
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
