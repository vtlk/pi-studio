import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels } from '../../shared/contracts';
import type { ImageConnectionRequest } from '../../shared/connections';
import { ImageConnections } from './ImageConnections';
import { ImageGeneration } from './ImageGeneration';
import { SecretVault } from '../storage/SecretVault';
import type { StudioService } from '../storage/StudioStore';

export function createImageServices(service: StudioService) {
  const connections = new ImageConnections(
    service,
    new SecretVault(join(app.getPath('userData'), 'secrets'), safeStorage),
  );
  return {
    connections,
    images: new ImageGeneration(
      service,
      connections,
      join(app.getPath('userData'), 'image-operations'),
    ),
  };
}

export function registerImageHandlers(
  connections: ImageConnections,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  ipcMain.handle(desktopChannels.readImageConnection, (event, request: ImageConnectionRequest) => {
    caller(event);
    return connections.status(request);
  });
  ipcMain.handle(
    desktopChannels.saveImageKey,
    (event, request: ImageConnectionRequest & { key: string }) => {
      caller(event);
      return connections.save(request);
    },
  );
  ipcMain.handle(desktopChannels.removeImageKey, (event, request: ImageConnectionRequest) => {
    caller(event);
    return connections.remove(request);
  });
  ipcMain.handle(desktopChannels.checkImageConnection, (event, request: ImageConnectionRequest) => {
    caller(event);
    return connections.check(request);
  });
}
