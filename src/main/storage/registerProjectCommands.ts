import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ProjectCommand } from '../../shared/storage';
import type { StudioService, StudioStore } from './StudioStore';
import type { RunHost } from '../pi/RunHost';
import { desktopChannels } from '../../shared/contracts';
import { snapshotAgent } from './validation';

export function registerProjectCommands(
  service: StudioService,
  runs: RunHost,
  images: { assertIdle: (projectId?: string) => void },
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  ipcMain.handle(desktopChannels.projectCommand, async (event, command: ProjectCommand) => {
    caller(event);
    const templates = async (store: StudioStore) => {
      const teamId =
        command.kind === 'create'
          ? command.teamId
          : command.kind === 'update-agents'
            ? (await store.projects.read(command.projectId)).sourceTeamId
            : undefined;
      if (!teamId) throw new Error('Выберите команду агентов для проекта.');
      const current = store.teamProfiles(teamId);
      if (
        command.kind === 'update-agents' &&
        JSON.stringify(current.map((agent) => snapshotAgent(agent).profile)) !==
          JSON.stringify(command.agents.map((agent) => snapshotAgent(agent).profile))
      )
        throw new Error(
          'Общий список агентов изменился. Перечитайте настройки и откройте сравнение заново.',
        );
      return current;
    };
    if (command.kind === 'remove-agent') await runs.stopAgent(command.projectId, command.agentId);
    else if ('projectId' in command) {
      runs.assertIdle(command.projectId);
      images.assertIdle(command.projectId);
    }
    if (command.kind === 'update-agents') {
      const removed = await service.serialize(async () => {
        const store = await service.load();
        const ids = new Set((await templates(store)).map((agent) => agent.id));
        return (await store.projects.read(command.projectId)).agents
          .filter((agent) => !ids.has(agent.profile.id))
          .map((agent) => agent.profile.id);
      });
      for (const id of removed) await runs.stopAgent(command.projectId, id);
    }
    const apply = () =>
      service.serialize(async () => {
        const store = await service.load();
        return store.command(
          command.kind === 'create' || command.kind === 'update-agents'
            ? { ...command, agents: await templates(store) }
            : command,
        );
      });
    return command.kind === 'clone' || command.kind === 'rename' || command.kind === 'remove'
      ? runs.withProjectChange(command.projectId, command.kind !== 'clone', apply)
      : apply();
  });
}
