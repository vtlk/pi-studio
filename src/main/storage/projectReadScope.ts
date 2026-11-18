import { t } from '../../shared/i18n/index.ts';
import type { StudioService, StudioStore } from './StudioStore.ts';
import { withReadDeadline } from './files.ts';

/** Slow filesystem reads never own the studio mutation queue; validate the captured scope again. */
export function readProjectScope<T>(
  service: StudioService,
  projectId: string,
  read: (store: StudioStore, root: string, signal: AbortSignal) => Promise<T>,
  discard?: (value: T) => void | Promise<void>,
): Promise<T> {
  const signal = AbortSignal.timeout(10_000);
  return withReadDeadline(async () => {
    const store = service.peek() ?? (await service.serialize(() => service.load()));
    signal.throwIfAborted();
    const root = store.projects.location(projectId);
    const result = await read(store, root, signal);
    try {
      signal.throwIfAborted();
      if (service.peek() !== store || store.projects.location(projectId) !== root)
        throw new Error(t('registerTeamHandlers.studioFolderChanged'));
      return result;
    } catch (error) {
      await discard?.(result);
      throw error;
    }
  });
}
