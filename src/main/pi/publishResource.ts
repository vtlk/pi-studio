import { t } from '../../shared/i18n/index.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import type { Resource } from '../../shared/resources.ts';

/** One serialized catalog commit; cancelled/revoked native work must never publish late. */
export function publishResource(
  service: StudioService,
  folder: string,
  resource: Resource,
  replaceName = false,
  signal?: AbortSignal,
  authorize?: (store: StudioStore) => Promise<void>,
) {
  return service.serialize(async () => {
    signal?.throwIfAborted();
    const store = await service.load();
    if (store.folder !== folder)
      throw new Error(t('error.studioResources.theStudioChangedTheResource'));
    await authorize?.(store);
    signal?.throwIfAborted();
    const current = (store.bootstrap().sections.resources ?? []) as Resource[];
    const old = current.find(
      (item) => item.kind === resource.kind && item.source === resource.source,
    );
    const saved = {
      ...resource,
      credential:
        old?.credential === 'keychain:pistudio-mcp' ? old.credential : resource.credential,
      ...(old?.mcpSecretNames ? { mcpSecretNames: old.mcpSecretNames } : {}),
      name: old && !replaceName ? old.name : resource.name,
      description: resource.description || old?.description || '',
      version: resource.version || old?.version || '',
      ...(old ? { id: old.id, createdAt: old.createdAt } : {}),
    };
    await store.saveSection('resources', [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
    return saved;
  });
}
