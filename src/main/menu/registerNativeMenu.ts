import { app, Menu, shell } from 'electron';
import { menuTemplate } from './menuTemplate';

export function registerNativeMenu(checkUpdates: () => void) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate(
        process.platform,
        {
          checkUpdates,
          about: () => app.showAboutPanel(),
          help: () => {
            void shell.openExternal('https://github.com/vtlk/pi-studio/issues');
          },
        },
        !app.isPackaged,
      ),
    ),
  );
}
