import { BrowserWindow, dialog, session, shell } from 'electron';
import { join } from 'node:path';

export function createStudioWindow(): BrowserWindow {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    existing.show();
    return existing;
  }
  const window = new BrowserWindow({
    width: 1512,
    height: 1000,
    minWidth: 1080,
    minHeight: 720,
    title: 'Pi Studio',
    backgroundColor: '#08090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
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
