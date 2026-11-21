import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { StudioService, StudioStore } from './StudioStore';
import type { ProjectActivity } from '../pi/ProjectActivity';
import { readProjectScope } from './projectReadScope.ts';

export function registerProjectQueries(
  service: StudioService,
  activity: ProjectActivity,
  caller: (event: IpcMainInvokeEvent) => unknown,
  autoContinuation: (projectId: string) => boolean,
  recover?: (store: StudioStore) => void,
) {
  handleDesktopInvoke(desktopChannels.listProjectActivity, (event) => {
    caller(event);
    return activity.list();
  });
  handleDesktopInvoke(desktopChannels.listProjectUsage, (event) => {
    caller(event);
    return service.serialize(async () => {
      const store = await service.load();
      recover?.(store);
      return store.accounting.list(store.projects.list());
    });
  });
  handleDesktopInvoke(desktopChannels.readProject, (event, id: string) => {
    caller(event);
    return readProjectScope(service, id, async (store, _root, signal) => {
      const project = store.accounting.enrich(await store.projects.read(id, signal));
      return { ...project, autoContinue: autoContinuation(id) };
    });
  });
}
