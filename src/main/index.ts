import { app, protocol } from 'electron';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { applicationRoot } from './updates/registerNativeUpdates';
import { resolveUpdateStartup } from './updates/UpdateStartup';
import type { NativeUpdates } from './updates/NativeUpdates';
import { createStudioWindow } from './windows/createStudioWindow';
import { registerDesktopHandlers } from './ipc/registerDesktopHandlers';
import { mediaResponse } from './storage/media';
import packageInfo from '../../package.json';
import { registerNativeMenu } from './menu/registerNativeMenu';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName('Pi Studio');
let updates: NativeUpdates | undefined;
let desktopReady = false;
async function startStudio() {
  if (!['darwin', 'win32'].includes(process.platform)) {
    console.error('Pi Studio supports macOS and Windows.');
    app.quit();
    return;
  }
  const boot = app.isPackaged
    ? await resolveUpdateStartup({
        appRoot: await realpath(applicationRoot(process.execPath)),
        executable: await realpath(process.execPath),
        version: packageInfo.version,
        userData: app.getPath('userData'),
        argv: process.argv,
        quit: () => app.quit(),
      })
    : { userData: app.getPath('userData'), startup: undefined };
  if (boot.userData !== app.getPath('userData')) app.setPath('userData', boot.userData);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await boot.startup?.start();
  if (boot.startup?.read().phase === 'aborting') return;
  await app.whenReady();
  if (process.platform === 'win32') app.setAppUserModelId('studio.pi.desktop');
  app.setAboutPanelOptions({
    applicationName: 'Pi Studio',
    applicationVersion: packageInfo.version,
    version: packageInfo.version,
  });
  app.dock?.setIcon(
    join(
      __dirname,
      process.env.ELECTRON_RENDERER_URL
        ? '../../public/branding/pi-studio-icon.png'
        : '../renderer/branding/pi-studio-icon.png',
    ),
  );
  const service = registerDesktopHandlers({
    startup: boot.startup,
    updates: (value) => {
      updates = value;
    },
  });
  await updates?.initialize();
  registerNativeMenu(() => {
    createStudioWindow().focus();
    void updates?.check();
  });
  protocol.handle('studio-media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'output') return new Response(null, { status: 403 });
      const [projectId, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent);
      const root = await service.serialize(async () =>
        (await service.load()).projects.directory(projectId),
      );
      return await mediaResponse(root, parts.join('/'), request);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  desktopReady = true;
  createStudioWindow();
  app.on('activate', createStudioWindow);
}
void startStudio().catch((error: unknown) => {
  console.error(
    'Pi Studio startup failed:',
    error instanceof Error ? error.message : 'Unknown startup error',
  );
  app.quit();
});
app.on('second-instance', () => {
  if (desktopReady) createStudioWindow().focus();
});
app.on('window-all-closed', () => {
  // macOS keeps the application alive after its last window closes.
  if (process.platform !== 'darwin') app.quit();
});
