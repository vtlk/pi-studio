import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { StudioResources } from './StudioResources';

export function registerResourceHandlers(
  resources: StudioResources,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  handleDesktopInvoke(desktopChannels.checkResource, (event, id: string) => {
    caller(event);
    return resources.check(id);
  });
  handleDesktopInvoke(desktopChannels.installResource, (event, id: string) => {
    caller(event);
    return resources.install(id);
  });
  handleDesktopInvoke(desktopChannels.openResourceLogin, (event, id: string) => {
    caller(event);
    return resources.login(id);
  });
}
