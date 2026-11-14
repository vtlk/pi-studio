import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { StudioResources } from './StudioResources';

export function registerResourceHandlers(
  resources: StudioResources,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  ipcMain.handle(desktopChannels.checkResource, (event, id: string) => {
    caller(event);
    return resources.check(id);
  });
  ipcMain.handle(desktopChannels.installResource, (event, id: string) => {
    caller(event);
    return resources.install(id);
  });
  ipcMain.handle(desktopChannels.openResourceLogin, (event, id: string) => {
    caller(event);
    return resources.login(id);
  });
}
