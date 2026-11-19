import { setKeepWindowForUpdate, setUpdateQuitGuard } from './createStudioWindow.ts';
import type { NativeUpdates } from '../updates/NativeUpdates.ts';
import type { UpdateStartup } from '../updates/UpdateStartup.ts';

export function bindUpdateWindow(updates: NativeUpdates, startup?: UpdateStartup) {
  setKeepWindowForUpdate(() =>
    ['downloading', 'verifying', 'waiting'].includes(updates.read().phase),
  );
  setUpdateQuitGuard(() => {
    if (updates.installing) {
      updates.quitPrevented();
      return 'keep';
    }
    const phase = startup?.read().phase;
    return phase && !['committed', 'restored'].includes(phase) ? 'close' : undefined;
  });
}
