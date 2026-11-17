import { t } from '../../shared/i18n/index.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { type IpcMainInvokeEvent } from 'electron';
import type { ProjectCommand } from '../../shared/storage';
import type { StudioService, StudioStore } from './StudioStore';
import type { RunHost } from '../pi/RunHost';
import { desktopChannels } from '../../shared/contracts';
import { AgentRefresh } from './AgentRefresh';

export function registerProjectCommands(
  service: StudioService,
  runs: RunHost,
  images: { assertIdle: (projectId?: string) => void },
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  const refresh = new AgentRefresh(service, runs);
  handleDesktopInvoke(
    desktopChannels.prepareAgentRefresh,
    (event, request: { projectId: string; updateExisting: boolean }) => {
      caller(event);
      if (!request) throw new Error(t('AgentRefresh.invalidRequest'));
      return refresh.prepare(request.projectId, request.updateExisting);
    },
  );
  handleDesktopInvoke(desktopChannels.projectCommand, async (event, command: ProjectCommand) => {
    caller(event);
    if (command.kind === 'update-agents') return refresh.apply(command);
    const templates = async (store: StudioStore) => {
      const teamId = command.kind === 'create' ? command.teamId : undefined;
      if (!teamId) throw new Error(t('error.registerProjectCommands.selectAnAgentTeamFor'));
      const current = store.teamProfiles(teamId);
      return current;
    };
    if (command.kind === 'remove-agent') await runs.stopAgent(command.projectId, command.agentId);
    else if ('projectId' in command) {
      runs.assertIdle(command.projectId);
      images.assertIdle(command.projectId);
    }
    const apply = () =>
      service.serialize(async () => {
        const store = await service.load();
        return store.command(
          command.kind === 'create' ? { ...command, agents: await templates(store) } : command,
        );
      });
    return command.kind === 'clone' || command.kind === 'rename' || command.kind === 'remove'
      ? runs.withProjectChange(command.projectId, command.kind !== 'clone', apply)
      : apply();
  });
}
