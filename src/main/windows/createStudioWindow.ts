import { BrowserWindow, session } from 'electron';
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
    backgroundColor: '#f6f5f1',
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
