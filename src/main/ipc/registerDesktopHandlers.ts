import { app, BrowserWindow, ipcMain } from 'electron';
import { desktopChannels, type DesktopInfo } from '../../shared/contracts';

export function registerDesktopHandlers(): void {
  ipcMain.handle(desktopChannels.getInfo, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown desktop API caller');
    }
    return { platform: 'darwin', version: app.getVersion(), prototype: true } satisfies DesktopInfo;
  });
}
