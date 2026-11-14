import { BrowserWindow } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { RunDependencies } from './RunTypes';

export const notifyRunFailure: NonNullable<RunDependencies['failureChanged']> = (run, failure) => {
  const notice = {
    projectRoot: run.projectRoot,
    projectId: run.project.id,
    agentId: run.agent.profile.id,
    agentName: run.agent.profile.name,
    failure,
  };
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send(desktopChannels.runFailure, notice);
};
