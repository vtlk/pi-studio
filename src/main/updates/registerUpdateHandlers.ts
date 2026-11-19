import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts.ts';
import type { UpdateReadiness } from '../../shared/updates.ts';
import type { NativeUpdates } from './NativeUpdates.ts';
import type { UpdateCoordinator } from './UpdateCoordinator.ts';

/** Control stays reachable while the ordinary invocation gate holds the application. */
export function registerUpdateHandlers(
  updates: Pick<NativeUpdates | UpdateCoordinator, 'read' | 'check' | 'request' | 'report'>,
  caller: (event: IpcMainInvokeEvent) => unknown,
  refreshWindow?: () => void,
) {
  ipcMain.handle(desktopChannels.getUpdateState, (event) => {
    caller(event);
    const state = updates.read();
    refreshWindow?.();
    return state;
  });
  ipcMain.handle(desktopChannels.checkForUpdates, (event) => {
    caller(event);
    return updates.check();
  });
  ipcMain.handle(desktopChannels.requestUpdate, (event) => {
    caller(event);
    return updates.request();
  });
  ipcMain.handle(desktopChannels.reportUpdateReadiness, (event, ready: UpdateReadiness) => {
    caller(event);
    return updates.report(ready);
  });
}
