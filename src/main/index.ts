import { app } from 'electron';
import { createStudioWindow } from './windows/createStudioWindow';
import { registerDesktopHandlers } from './ipc/registerDesktopHandlers';

app.setName('Pi Studio');
app.whenReady().then(() => {
  registerDesktopHandlers();
  createStudioWindow();
  app.on('activate', createStudioWindow);
});
app.on('window-all-closed', () => {
  // macOS keeps the application alive after its last window closes.
});
