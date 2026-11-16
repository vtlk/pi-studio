import { t } from '../../shared/i18n/index.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type {
  Connection,
  ImageConnectionRequest,
  ImageConnectionStatus,
} from '../../shared/connections.ts';
import type { SecretVault } from '../storage/SecretVault.ts';
import { stableId } from '../storage/validation.ts';
import { ImagesApi, ImagesApiError } from './ImagesApi.ts';

export class ImageConnections {
  private service: StudioService;
  private vault: SecretVault;
  readonly api: ImagesApi;
  private checked = new Map<
    string,
    {
      revision: string;
      checkedAt: number;
      modelIds: string[];
      authentication: 'ready' | 'invalid' | 'restricted';
    }
  >();
  constructor(service: StudioService, vault: SecretVault, api = new ImagesApi()) {
    this.service = service;
    this.vault = vault;
    this.api = api;
  }
  private async scope(request: ImageConnectionRequest) {
    stableId(request?.connectionId);
    return this.service.serialize(async () => {
      const store = await this.service.load();
      if (store.folder !== request.folder)
        throw new Error(t('error.imageConnections.theStudioFolderChangedReopen'));
      const connection = ((store.bootstrap().sections.connections ?? []) as Connection[]).find(
        (item) => item.id === request.connectionId,
      );
      if (
        !connection ||
        connection.purpose !== 'images' ||
        connection.providerId !== 'openai' ||
        connection.endpoint
      )
        throw new Error(t('error.imageConnections.theOpenaiImagesApiConnection'));
      return {
        folder: store.folder,
        id: connection.id,
        cache: `${store.folder}\0${connection.id}`,
      };
    });
  }
  async status(request: ImageConnectionRequest): Promise<ImageConnectionStatus> {
    const scope = await this.scope(request),
      stored = await this.vault.inspect(scope.folder, scope.id);
    const cache = this.checked.get(scope.cache);
    return {
      keyStored: stored.stored,
      authentication: cache?.revision === stored.revision ? cache.authentication : 'unchecked',
      modelIds: cache?.revision === stored.revision ? cache.modelIds : [],
      ...(cache?.revision === stored.revision ? { checkedAt: cache.checkedAt } : {}),
    };
  }
  async save(request: ImageConnectionRequest & { key: string }) {
    if (typeof request?.key !== 'string' || !/^[\x21-\x7e]{10,8192}$/.test(request.key.trim()))
      throw new Error(t('error.imageConnections.enterAValidApiKey'));
    const scope = await this.scope(request);
    await this.vault.save(scope.folder, scope.id, request.key);
    this.checked.delete(scope.cache);
    await this.scope(request);
    return this.status(request);
  }
  async remove(request: ImageConnectionRequest) {
    const scope = await this.scope(request);
    await this.vault.remove(scope.folder, scope.id);
    this.checked.delete(scope.cache);
    return this.status(request);
  }
  async check(request: ImageConnectionRequest) {
    const scope = await this.scope(request),
      before = await this.vault.inspect(scope.folder, scope.id);
    const key = await this.vault.read(scope.folder, scope.id);
    let models: string[];
    try {
      models = await this.api.models(key);
    } catch (error) {
      await this.scope(request);
      if ((await this.vault.inspect(scope.folder, scope.id)).revision !== before.revision)
        throw new Error(t('error.imageConnections.theKeyChangedDuringVerification'), {
          cause: error,
        });
      this.checked.delete(scope.cache);
      if (error instanceof ImagesApiError && ['authentication', 'access'].includes(error.kind))
        this.checked.set(scope.cache, {
          revision: before.revision,
          checkedAt: Date.now(),
          modelIds: [],
          authentication: error.kind === 'access' ? 'restricted' : 'invalid',
        });
      throw error;
    }
    await this.scope(request);
    if ((await this.vault.inspect(scope.folder, scope.id)).revision !== before.revision)
      throw new Error(t('error.imageConnections.theKeyChangedDuringVerification'));
    this.checked.set(scope.cache, {
      revision: before.revision,
      checkedAt: Date.now(),
      modelIds: models,
      authentication: 'ready',
    });
    return this.status(request);
  }
  async key(request: ImageConnectionRequest) {
    return (await this.authorization(request)).key;
  }
  async authorization(request: ImageConnectionRequest) {
    const scope = await this.scope(request);
    const before = await this.vault.inspect(scope.folder, scope.id);
    const key = await this.vault.read(scope.folder, scope.id);
    const current = await this.vault.inspect(scope.folder, scope.id);
    if (current.revision !== before.revision || !current.stored)
      throw new Error(t('error.imageConnections.theKeyChangedWhileBeing'));
    return { key, revision: current.revision };
  }
  async reportAuthorization(
    request: ImageConnectionRequest,
    revision: string,
    valid: boolean | 'restricted',
    modelId?: string,
  ) {
    const scope = await this.scope(request);
    if ((await this.vault.inspect(scope.folder, scope.id)).revision !== revision) return;
    const previous = this.checked.get(scope.cache);
    this.checked.set(scope.cache, {
      revision,
      checkedAt: Date.now(),
      authentication: valid === 'restricted' ? 'restricted' : valid ? 'ready' : 'invalid',
      modelIds:
        valid === true
          ? [
              ...new Set([
                ...(previous?.revision === revision ? previous.modelIds : []),
                ...(modelId ? [modelId] : []),
              ]),
            ].sort()
          : [],
    });
  }
}
