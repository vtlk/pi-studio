import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels, type DesktopInfo } from '../../shared/contracts';
import type { FileRequest, ProjectCommand, StorageSection } from '../../shared/storage';
import { StudioService } from '../storage/StudioStore';
import { loadOutput } from '../storage/outputs';
import { safePath } from '../storage/files';
import { checkPi } from '../pi/checkPi';
import { readStandard, writeStandard } from '../storage/standards';
import type { LibraryStandard, StandardFile } from '../../shared/libraryStandards';
import { readFile } from 'node:fs/promises';
import { getProviderStatus, openProviderLogin } from '../pi/provider';
import { importSkill, inspectSkill } from '../storage/skills';
import type { Resource } from '../../shared/resources';

export function registerDesktopHandlers(): StudioService {
  const bundled = join(
    __dirname,
    app.isPackaged
      ? '../../bundled/pi-studio-library'
      : '../../technical-spec/bundled/pi-studio-library',
  );
  const service = new StudioService(
    join(app.getPath('userData'), 'workspace.json'),
    join(app.getPath('documents'), 'Pi Studio'),
    bundled,
  );
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
  handle(
    desktopChannels.getInfo,
    () =>
      ({
        platform: 'darwin',
        version: app.getVersion(),
        runtimeConnected: false,
      }) satisfies DesktopInfo,
  );
  handle(desktopChannels.checkPi, (_event, path: string) => checkPi(path));
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
    return getProviderStatus(String(store.bootstrap().sections.piPath ?? ''), provider);
  });
  handle(desktopChannels.openProviderLogin, async (_event, provider: string) => {
    const store = await service.load();
    await openProviderLogin(
      String(store.bootstrap().sections.piPath ?? ''),
      provider,
      store.folder,
    );
  });
  handle(desktopChannels.readStandard, async (_event, skill: LibraryStandard, file: StandardFile) =>
    readStandard((await service.load()).folder, skill, file),
  );
  handle(
    desktopChannels.saveStandard,
    async (_event, skill: LibraryStandard, file: StandardFile, content: string) =>
      writeStandard((await service.load()).folder, skill, file, content),
  );
  handle(
    desktopChannels.resetStandard,
    async (_event, skill: LibraryStandard, file: StandardFile) => {
      const root = (await service.load()).folder;
      await readStandard(root, skill, file); // Validate the allowlisted skill and relative file before reading bundled text.
      return writeStandard(
        root,
        skill,
        file,
        await readFile(join(bundled, 'skills', skill, file), 'utf8'),
      );
    },
  );
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
    (await service.load()).projects.read(id),
  );
  handle(desktopChannels.readOutput, async (_event, request: FileRequest) => {
    const file = await loadOutput(
      await (await service.load()).projects.directory(request.projectId),
      request.path,
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
