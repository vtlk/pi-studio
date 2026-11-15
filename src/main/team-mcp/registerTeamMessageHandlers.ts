import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { TeamMessageAction } from '../../shared/teamMessages';
import type { TeamSupport } from './TeamSupport';

export function registerTeamMessageHandlers(
  team: TeamSupport,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  handleDesktopInvoke(desktopChannels.listTeamMessages, (event, projectId: string) => {
    caller(event);
    return team.projectMessages(projectId);
  });
  handleDesktopInvoke(desktopChannels.manageTeamMessage, (event, request: TeamMessageAction) => {
    caller(event);
    return team.manageMessage(request);
  });
}
