import { app, protocol, nativeTheme } from 'electron';
import { LanguagePreferences } from './appearance/LanguagePreferences';
import { GitHubStarReminder } from './github-star/GitHubStarReminder';
import { ThemePreferences } from './appearance/ThemePreferences';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { applicationRoot } from './updates/registerNativeUpdates';
import { resolveUpdateStartup } from './updates/UpdateStartup';
import type { NativeUpdates } from './updates/NativeUpdates';
import { createStudioWindow } from './windows/createStudioWindow';
import { registerDesktopHandlers } from './ipc/registerDesktopHandlers';
import { readProjectScope } from './storage/projectReadScope';
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
  await app.whenReady();
  const language = await LanguagePreferences.load(
    join(app.getPath('userData'), 'language.json'),
    app.getPreferredSystemLanguages()[0] ?? app.getLocale(),
  );
  await boot.startup?.start();
  if (boot.startup?.read().phase === 'aborting') return;
  const appearance = await ThemePreferences.load(
    join(app.getPath('userData'), 'appearance.json'),
    nativeTheme,
  );
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
    githubStar: await GitHubStarReminder.load(join(app.getPath('userData'), 'github-star.json')),
    appearance,
    language,
    startup: boot.startup,
    updates: (value) => {
      updates = value;
    },
  });
  const rebuildMenu = () =>
    registerNativeMenu(() => {
      createStudioWindow().focus();
      void updates?.check();
    });
  rebuildMenu();
  language.subscribe(rebuildMenu);
  protocol.handle('studio-media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'output') return new Response(null, { status: 403 });
      const [projectId, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent);
      return await readProjectScope(
        service,
        projectId,
        (_store, root) => mediaResponse(root, parts.join('/'), request),
        async (response) => {
          await response.body?.cancel();
        },
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  desktopReady = true;
  createStudioWindow();
  app.on('activate', createStudioWindow);
  // Project hydration and update-view restoration must not hide the entire application window.
  await updates?.initialize();
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
