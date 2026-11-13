import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { ModelConnectionRequest, ModelLoginRequest } from '../../shared/connections';
import type { StudioService } from '../storage/StudioStore';
import type { BrowserAuth } from './BrowserAuth';
import { getProviderStatus, openProviderLogin } from './provider';
import { ModelConnections } from './ModelConnections';

export function registerModelConnectionHandlers(
  service: StudioService,
  directory: string,
  scripts: string,
  piPath: () => string,
  auth: BrowserAuth,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  const connections = new ModelConnections(service, directory, scripts, piPath, auth);
  ipcMain.handle(
    desktopChannels.discoverConnectionModels,
    (event, request: ModelConnectionRequest) => {
      caller(event);
      return connections.discover(request);
    },
  );
  ipcMain.handle(desktopChannels.getModelCatalog, (event, request?: ModelConnectionRequest) => {
    caller(event);
    return connections.catalog(request);
  });
  ipcMain.handle(desktopChannels.getConnectionStatus, (event, request: ModelConnectionRequest) => {
    caller(event);
    return connections.status(request);
  });
  ipcMain.handle(desktopChannels.beginConnectionLogin, (event, request: ModelLoginRequest) => {
    caller(event);
    return connections.login(request);
  });
  ipcMain.handle(
    desktopChannels.removeConnectionLogin,
    (event, request: ModelConnectionRequest) => {
      caller(event);
      return connections.logout(request);
    },
  );
  ipcMain.handle(desktopChannels.beginCodexLogin, async (event) => {
    caller(event);
    const path = await service.serialize(
      async () => String((await service.load()).bootstrap().sections.piPath ?? '') || piPath(),
    );
    return auth.start(path);
  });
  ipcMain.handle(desktopChannels.getProviderStatus, async (event, provider: string) => {
    caller(event);
    const path = await service.serialize(
      async () => String((await service.load()).bootstrap().sections.piPath ?? '') || piPath(),
    );
    return getProviderStatus(path, provider);
  });
  ipcMain.handle(desktopChannels.openProviderLogin, (event, provider: string) => {
    caller(event);
    return service.serialize(async () => {
      const store = await service.load();
      await openProviderLogin(
        String(store.bootstrap().sections.piPath ?? '') || piPath(),
        provider,
        store.folder,
      );
    });
  });
}
