import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels, type DesktopInfo } from '../../shared/contracts';
import type { FileRequest, ProjectCommand, StorageSection } from '../../shared/storage';
import { StudioService } from '../storage/StudioStore';
import { loadOutput } from '../storage/outputs';
import { safePath, withReadDeadline } from '../storage/files';
import { checkPi } from '../pi/checkPi';
import { getProviderStatus, openProviderLogin } from '../pi/provider';
import { importSkill, inspectSkill } from '../storage/skills';
import type { Resource } from '../../shared/resources';
import { BrowserAuth } from '../pi/BrowserAuth';
import { Startup } from '../pi/Startup';

export function registerDesktopHandlers(): StudioService {
  const service = new StudioService(
    join(app.getPath('userData'), 'workspace.json'),
    join(app.getPath('videos'), 'Pi Studio'),
  );
  const browserAuth = new BrowserAuth(join(__dirname, '../../bundled/pi-bridge/login.mjs'), (url) =>
    shell.openExternal(url),
  );
  const startup = new Startup({
    root: join(app.getPath('userData'), 'runtime/pi'),
    bundled: join(__dirname, '../../bundled/pi-runtime'),
    configuredPath: async () => {
      try {
        return await service.serialize(async () =>
          String((await service.load()).bootstrap().sections.piPath ?? ''),
        );
      } catch {
        return '';
      }
    },
  });
  app.on('before-quit', () => {
    browserAuth.close();
    startup.close();
  });
  function caller(event: IpcMainInvokeEvent) {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown desktop API caller');
    }
    return window;
  }
  function handle(
    channel: string,
    action: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  ) {
    ipcMain.handle(channel, (event, ...args) => {
      caller(event);
      return service.serialize(() => Promise.resolve(action(event, ...(args as never[]))));
    });
  }
  ipcMain.handle(desktopChannels.beginCodexLogin, async (event) => {
    caller(event);
    const path = await service.serialize(async () =>
      String((await service.load()).bootstrap().sections.piPath ?? ''),
    );
    return browserAuth.start(path || startup.path);
  });
  ipcMain.handle(desktopChannels.readAuthLogin, (event, id: string) => {
    caller(event);
    return browserAuth.read(id);
  });
  ipcMain.handle(desktopChannels.cancelAuthLogin, (event, id: string) => {
    caller(event);
    browserAuth.cancel(id);
  });
  ipcMain.handle(
    desktopChannels.answerAuthLogin,
    (event, id: string, promptId: string, answer: string) => {
      caller(event);
      browserAuth.answer(id, promptId, answer);
    },
  );
  handle(
    desktopChannels.getInfo,
    () =>
      ({
        platform: 'darwin',
        version: app.getVersion(),
        runtimeConnected: false,
      }) satisfies DesktopInfo,
  );
  ipcMain.handle(desktopChannels.getStartup, (event) => {
    caller(event);
    return startup.read();
  });
  ipcMain.handle(desktopChannels.retryStartup, (event) => {
    caller(event);
    return startup.retry();
  });
  ipcMain.handle(desktopChannels.skipStartup, (event) => {
    caller(event);
    return startup.skip();
  });
  ipcMain.handle(desktopChannels.chooseStartupPi, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Выберите установленный Pi',
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const state = await startup.choose(result.filePaths[0]);
    await service.serialize(async () =>
      (await service.load()).saveSection('piPath', state.pi!.path),
    );
    return state;
  });
  handle(desktopChannels.checkPi, (_event, path: string) => checkPi(path || startup.path));
  handle(desktopChannels.chooseSkill, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Папка skill или SKILL.md',
      properties: ['openDirectory', 'openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const store = await service.load();
    const existing = (store.bootstrap().sections.resources ?? []) as Resource[];
    const skill = await importSkill(result.filePaths[0], existing);
    await store.saveSection('resources', [
      skill,
      ...existing.filter((item) => item.id !== skill.id),
    ]);
    return skill;
  });
  handle(desktopChannels.readSkill, async (_event, id: string) => {
    const resources = (await service.load()).bootstrap().sections.resources as
      Resource[] | undefined;
    const resource = resources?.find(
      (item) => item.id === id && item.kind === 'skills' && item.localSkill,
    );
    if (!resource) throw new Error('Локальный skill не найден в каталоге.');
    return inspectSkill(resource.source);
  });
  handle(desktopChannels.getProviderStatus, async (_event, provider: string) => {
    const store = await service.load();
    return getProviderStatus(
      String(store.bootstrap().sections.piPath ?? '') || startup.path,
      provider,
    );
  });
  handle(desktopChannels.openProviderLogin, async (_event, provider: string) => {
    const store = await service.load();
    await openProviderLogin(
      String(store.bootstrap().sections.piPath ?? '') || startup.path,
      provider,
      store.folder,
    );
  });
  handle(desktopChannels.loadStudio, async () => (await service.load()).bootstrap());
  handle(desktopChannels.openStudio, (_event, folder: string) => service.open(folder));
  handle(desktopChannels.chooseStudio, async (event) => {
    let defaultPath = app.getPath('documents');
    try {
      defaultPath = (await service.load()).folder;
    } catch {
      /* Let the user recover by explicitly choosing another studio. */
    }
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Папка Pi Studio',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return service.open(result.filePaths[0]);
  });
  handle(desktopChannels.saveSection, async (_event, section: StorageSection, value: unknown) =>
    (await service.load()).saveSection(section, value),
  );
  handle(desktopChannels.projectCommand, async (_event, command: ProjectCommand) =>
    (await service.load()).command(command),
  );
  handle(desktopChannels.readProject, async (_event, id: string) =>
    withReadDeadline(async () => (await service.load()).projects.read(id)),
  );
  handle(desktopChannels.readOutput, async (_event, request: FileRequest) => {
    const file = await withReadDeadline(async () =>
      loadOutput(await (await service.load()).projects.directory(request.projectId), request.path),
    );
    if (['image', 'audio', 'video'].includes(file.format))
      file.src = `studio-media://output/${encodeURIComponent(request.projectId)}/${request.path.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(file.fingerprint ?? '')}`;
    return file;
  });
  handle(desktopChannels.revealOutput, async (_event, request: FileRequest) => {
    const root = await (await service.load()).projects.directory(request.projectId);
    await loadOutput(root, request.path);
    shell.showItemInFolder(await safePath(root, request.path));
  });
  return service;
}
