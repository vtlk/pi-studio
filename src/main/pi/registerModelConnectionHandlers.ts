import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { type IpcMainInvokeEvent } from 'electron';
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
  handleDesktopInvoke(
    desktopChannels.manageClaudeCode,
    (event, request: ModelConnectionRequest & { action: 'install' | 'login' | 'logout' }) => {
      caller(event);
      return connections.claudeCode(request);
    },
  );
  handleDesktopInvoke(desktopChannels.readAuthLogin, (event, id: string) => {
    caller(event);
    return auth.read(id);
  });
  handleDesktopInvoke(desktopChannels.cancelAuthLogin, (event, id: string) => {
    caller(event);
    auth.cancel(id);
  });
  handleDesktopInvoke(
    desktopChannels.answerAuthLogin,
    (event, id: string, promptId: string, answer: string) => {
      caller(event);
      auth.answer(id, promptId, answer);
    },
  );
  handleDesktopInvoke(
    desktopChannels.discoverConnectionModels,
    (event, request: ModelConnectionRequest) => {
      caller(event);
      return connections.discover(request);
    },
  );
  handleDesktopInvoke(
    desktopChannels.getModelCatalog,
    (event, request?: ModelConnectionRequest) => {
      caller(event);
      return connections.catalog(request);
    },
  );
  handleDesktopInvoke(
    desktopChannels.getConnectionStatus,
    (event, request: ModelConnectionRequest) => {
      caller(event);
      return connections.status(request);
    },
  );
  handleDesktopInvoke(desktopChannels.beginConnectionLogin, (event, request: ModelLoginRequest) => {
    caller(event);
    return connections.login(request);
  });
  handleDesktopInvoke(
    desktopChannels.removeConnectionLogin,
    (event, request: ModelConnectionRequest) => {
      caller(event);
      return connections.logout(request);
    },
  );
  handleDesktopInvoke(desktopChannels.beginCodexLogin, async (event) => {
    caller(event);
    const path = await service.serialize(
      async () => String((await service.load()).bootstrap().sections.piPath ?? '') || piPath(),
    );
    return auth.start(path);
  });
  handleDesktopInvoke(desktopChannels.getProviderStatus, async (event, provider: string) => {
    caller(event);
    const path = await service.serialize(
      async () => String((await service.load()).bootstrap().sections.piPath ?? '') || piPath(),
    );
    return getProviderStatus(path, provider);
  });
  handleDesktopInvoke(desktopChannels.openProviderLogin, (event, provider: string) => {
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
  return connections;
}
