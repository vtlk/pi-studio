import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke';
import type { ThemePreferences } from './ThemePreferences';

export function registerAppearance(
  settings: ThemePreferences,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  handleDesktopInvoke(desktopChannels.getTheme, (event) => {
    caller(event);
    return settings.read();
  });
  handleDesktopInvoke(desktopChannels.setTheme, (event, value: unknown) => {
    caller(event);
    return settings.set(value);
  });
  settings.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(state.theme === 'dark' ? '#171717' : '#f8f9fb');
      window.webContents.send(desktopChannels.themeChanged, state);
    }
  });
}
