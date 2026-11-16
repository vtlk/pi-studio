import type { IpcMainInvokeEvent } from 'electron';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { desktopChannels } from '../../shared/contracts';
import type { BrowserSupport } from './BrowserSupport.ts';

export function registerBrowserHandlers(
  browser: BrowserSupport,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  handleDesktopInvoke(desktopChannels.getBrowserState, (event) => {
    caller(event);
    return browser.state();
  });
  handleDesktopInvoke(desktopChannels.installVisibleBrowser, (event) => {
    caller(event);
    return browser.installVisible();
  });
}
