import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke';
import type { LanguagePreferences } from './LanguagePreferences';

export function registerLanguage(
  settings: LanguagePreferences,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  handleDesktopInvoke(desktopChannels.getLanguage, (event) => {
    caller(event);
    return settings.read();
  });
  handleDesktopInvoke(desktopChannels.setLanguage, (event, value: unknown) => {
    caller(event);
    return settings.set(value);
  });
  settings.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(desktopChannels.languageChanged, state);
  });
}
