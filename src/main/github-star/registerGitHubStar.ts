import { app, BrowserWindow, powerMonitor, shell, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import { githubRepositoryUrl, type GitHubStarState } from '../../shared/githubStar';
import { handleDesktopInvoke } from '../ipc/desktopInvoke';
import type { GitHubStarReminder } from './GitHubStarReminder';

export function registerGitHubStar(
  reminder: GitHubStarReminder,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  const windows = new Map<BrowserWindow, { sheets: number; dispose: () => void }>();
  let poll: ReturnType<typeof setInterval> | undefined;
  function state(window: BrowserWindow): GitHubStarState {
    return {
      ...reminder.read(),
      canPresent:
        !window.isDestroyed() &&
        window.isVisible() &&
        window.isFocused() &&
        !window.isMinimized() &&
        window.isEnabled() &&
        !windows.get(window)?.sheets,
    };
  }
  function broadcast() {
    for (const window of windows.keys()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(desktopChannels.githubStarChanged, state(window));
    }
    // A Windows native modal temporarily disables its parent without a focus event.
    // Poll only a pending reminder; never create, show or focus a window.
    if (reminder.read().due && !poll) {
      poll = setInterval(broadcast, 1000);
      poll.unref();
    } else if (!reminder.read().due && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  }
  function attach(window: BrowserWindow) {
    if (windows.has(window)) return;
    const item = { sheets: 0, dispose: () => {} };
    const begin = () => {
      item.sheets++;
      broadcast();
    };
    const end = () => {
      item.sheets = Math.max(0, item.sheets - 1);
      broadcast();
    };
    window.on('focus', broadcast);
    window.on('blur', broadcast);
    window.on('show', broadcast);
    window.on('hide', broadcast);
    window.on('minimize', broadcast);
    window.on('restore', broadcast);
    window.on('sheet-begin', begin);
    window.on('sheet-end', end);
    item.dispose = () => {
      window.removeListener('focus', broadcast);
      window.removeListener('blur', broadcast);
      window.removeListener('show', broadcast);
      window.removeListener('hide', broadcast);
      window.removeListener('minimize', broadcast);
      window.removeListener('restore', broadcast);
      window.removeListener('sheet-begin', begin);
      window.removeListener('sheet-end', end);
    };
    windows.set(window, item);
    window.once('closed', () => {
      item.dispose();
      windows.delete(window);
    });
  }
  const created = (_event: unknown, window: BrowserWindow) => attach(window);
  app.on('browser-window-created', created);
  for (const window of BrowserWindow.getAllWindows()) attach(window);
  const unsubscribe = reminder.subscribe(broadcast);
  const suspend = () => {
    void reminder.suspend();
  };
  const resume = () => reminder.resume();
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('resume', resume);
  handleDesktopInvoke(desktopChannels.getGitHubStar, (event) => state(caller(event)));
  handleDesktopInvoke(desktopChannels.chooseGitHubStar, async (event, choice: unknown) => {
    const window = caller(event);
    await reminder.choose(choice, () => shell.openExternal(githubRepositoryUrl));
    return state(window);
  });
  return {
    async close() {
      unsubscribe();
      app.removeListener('browser-window-created', created);
      powerMonitor.removeListener('suspend', suspend);
      powerMonitor.removeListener('resume', resume);
      if (poll) clearInterval(poll);
      for (const item of windows.values()) item.dispose();
      windows.clear();
      await reminder.close();
    },
  };
}
