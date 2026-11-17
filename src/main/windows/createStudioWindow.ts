import { t } from '../../shared/i18n/index.ts';
import { app, BrowserWindow, dialog, session, shell, nativeTheme } from 'electron';
import { join } from 'node:path';
import { atomicJson } from '../storage/files.ts';
import { RendererRecovery } from './RendererRecovery.ts';

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
  let closing = false;
  window.on('close', () => {
    closing = true;
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
    closing = false; // A cancelled close must not disable later renderer recovery.
    // Installation cancellation must keep the window, without opening an OS dialog.
    if (updateQuitGuard?.()) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      message: t('createStudioWindow.changesHaveNotBeenSaved'),
      detail: t('createStudioWindow.waitForSavingToCompleteOrChoose'),
      buttons: [t('createStudioWindow.stay'), t('createStudioWindow.quitWithoutSaving')],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) {
      closing = true;
      event.preventDefault();
    }
  });
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const load = () =>
    developmentUrl
      ? window.loadURL(developmentUrl)
      : window.loadFile(join(__dirname, '../renderer/index.html'));
  const recovery = new RendererRecovery({
    isClosed: () => closing || window.isDestroyed() || window.webContents.isDestroyed(),
    load,
    askRetry: async () => {
      const result = await dialog.showMessageBox(window, {
        type: 'error',
        message: t('rendererRecovery.failed'),
        detail: t('rendererRecovery.detail'),
        buttons: [t('rendererRecovery.retry'), t('rendererRecovery.close')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
    close: () => window.close(),
    report: (failure) =>
      atomicJson(join(app.getPath('userData'), 'renderer-failure.json'), {
        at: new Date().toISOString(),
        reason: failure.reason,
        exitCode: failure.exitCode,
      }),
  });
  window.webContents.on('render-process-gone', (_event, details) => recovery.failed(details));
  window.once('closed', () => recovery.dispose());
  void load().catch(() => recovery.failed({ reason: 'load-failed' }));
  return window;
}
