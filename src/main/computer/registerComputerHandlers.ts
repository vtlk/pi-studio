import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { ComputerSupport } from './ComputerSupport';

/** Permission prompts are reachable only from an explicit trusted Studio UI action. */
export function registerComputerHandlers(
  computer: ComputerSupport,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  ipcMain.handle(desktopChannels.getComputerState, (event) => {
    caller(event);
    return computer.state();
  });
  ipcMain.handle(desktopChannels.requestComputerPermissions, async (event) => {
    caller(event);
    if (!app.isReady()) throw new Error('Дождитесь запуска Pi Studio.');
    if (process.platform !== 'darwin') return computer.state();
    const sdk = await import('@trycua/cua-driver/electron');
    sdk.requestMacOSPermissions();
    return computer.state();
  });
  ipcMain.handle(desktopChannels.openComputerSettings, async (event, kind: unknown) => {
    caller(event);
    if (process.platform !== 'darwin')
      throw new Error('Системные настройки macOS доступны только на Mac.');
    if (kind === 'accessibility')
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
    else if (kind === 'screen-recording') {
      const sdk = await import('@trycua/cua-driver/electron');
      await sdk.openMacOSScreenRecordingSettings();
    } else throw new Error('Неизвестный раздел разрешений macOS.');
  });
}
