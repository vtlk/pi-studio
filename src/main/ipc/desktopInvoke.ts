import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { InvocationGate } from '../updates/InvocationGate.ts';

export const desktopInvocationGate = new InvocationGate();
/** Do not wrap updater control endpoints: the ready acknowledgement must work during a lease. */
export function handleDesktopInvoke<Args extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
) {
  ipcMain.handle(channel, (event, ...args) =>
    desktopInvocationGate.invoke(() => listener(event, ...(args as Args))),
  );
}
