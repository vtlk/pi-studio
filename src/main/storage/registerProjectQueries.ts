import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { StudioService, StudioStore } from './StudioStore';
import type { ProjectActivity } from '../pi/ProjectActivity';
import { withReadDeadline } from './files';

export function registerProjectQueries(
  service: StudioService,
  activity: ProjectActivity,
  caller: (event: IpcMainInvokeEvent) => unknown,
  recover?: (store: StudioStore) => void,
) {
  ipcMain.handle(desktopChannels.listProjectActivity, (event) => {
    caller(event);
    return activity.list();
  });
  ipcMain.handle(desktopChannels.listProjectUsage, (event) => {
    caller(event);
    return service.serialize(async () => {
      const store = await service.load();
      recover?.(store);
      return store.accounting.list(store.projects.list());
    });
  });
  ipcMain.handle(desktopChannels.readProject, (event, id: string) => {
    caller(event);
    return service.serialize(() =>
      withReadDeadline(async () => {
        const store = await service.load();
        return store.accounting.enrich(await store.projects.read(id));
      }),
    );
  });
}
