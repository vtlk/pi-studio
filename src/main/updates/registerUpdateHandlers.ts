import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts.ts';
import type { UpdateReadiness } from '../../shared/updates.ts';
import type { UpdateCoordinator } from './UpdateCoordinator.ts';

/** Control stays reachable while the ordinary invocation gate holds the application. */
export function registerUpdateHandlers(
  updates: UpdateCoordinator,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  ipcMain.handle(desktopChannels.getUpdateState, (event) => {
    caller(event);
    return updates.read();
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
    updates.report(ready);
  });
}
