import { BrowserWindow } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { ChatTarget } from '../../shared/chat';

function broadcast(channel: string, target: ChatTarget) {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(channel, { projectId: target.projectId, agentId: target.agentId });
}
export const notifyChatChanged = (target: ChatTarget) =>
  broadcast(desktopChannels.chatChanged, target);
export const notifyChatOpened = (target: ChatTarget) =>
  broadcast(desktopChannels.chatOpened, target);
