import { BrowserWindow, dialog, session, shell, nativeTheme } from 'electron';
import { join } from 'node:path';

let studioWindow: BrowserWindow | undefined;
let updateQuitGuard: (() => boolean) | undefined;
export function setUpdateQuitGuard(guard: () => boolean) {
  updateQuitGuard = guard;
}
export function createStudioWindow(): BrowserWindow {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    return studioWindow;
  }
  const window = new BrowserWindow({
    width: 1512,
    height: 1000,
    minWidth: 1080,
    minHeight: 720,
    title: 'Pi Studio',
    ...(process.platform === 'win32'
      ? {
          icon: join(
            __dirname,
            process.env.ELECTRON_RENDERER_URL
              ? '../../public/branding/pi-studio-icon.png'
              : '../renderer/branding/pi-studio-icon.png',
          ),
        }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#f8f9fb',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 20, y: 20 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  studioWindow = window;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
    // Installation cancellation must keep the window, without opening an OS dialog.
    if (updateQuitGuard?.()) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      message: 'Изменения ещё не сохранены',
      detail: 'Дождитесь сохранения или выберите выход без сохранения.',
      buttons: ['Остаться', 'Выйти без сохранения'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
