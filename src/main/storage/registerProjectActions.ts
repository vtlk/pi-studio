import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { lstat } from 'node:fs/promises';
import { desktopChannels } from '../../shared/contracts';
import type { FileRequest, ClearAgentOutputRequest } from '../../shared/storage';
import type { StudioService } from './StudioStore';
import { safePath } from './files';
import { loadOutput } from './outputs';
import { stableId } from './validation';
import { clearAgentOutputs } from './clearAgentOutputs';

export function registerProjectActions(
  service: StudioService,
  caller: (event: IpcMainInvokeEvent) => unknown,
  mutation: {
    change: <T>(projectId: string, action: () => Promise<T>) => Promise<T>;
    cleared: (projectId: string, agentId: string) => void;
  },
) {
  ipcMain.handle(
    desktopChannels.clearAgentOutput,
    async (event, request: ClearAgentOutputRequest) => {
      caller(event);
      stableId(request?.projectId);
      stableId(request?.agentId);
      return mutation.change(request.projectId, () =>
        service.serialize(async () => {
          const project = await clearAgentOutputs(await service.load(), request, (path) =>
            shell.trashItem(path),
          );
          mutation.cleared(request.projectId, request.agentId);
          return project;
        }),
      );
    },
  );
  ipcMain.handle(desktopChannels.revealOutput, (event, request: FileRequest) => {
    caller(event);
    return service.serialize(async () => {
      const root = await (await service.load()).projects.directory(request.projectId);
      await loadOutput(root, request.path);
      shell.showItemInFolder(await safePath(root, request.path));
    });
  });
  ipcMain.handle(
    desktopChannels.revealAgentOutput,
    (event, request: { projectId: string; agentId: string }) => {
      caller(event);
      stableId(request?.projectId);
      stableId(request?.agentId);
      return service.serialize(async () => {
        const store = await service.load();
        const project = store.bootstrap().projects.find((item) => item.id === request.projectId);
        const agent = project?.agents.find((item) => item.profile.id === request.agentId);
        if (!agent) throw new Error('Агент отсутствует в проекте.');
        const path = await safePath(await store.projects.directory(project!.id), agent.outputPath);
        if (!(await lstat(path)).isDirectory())
          throw new Error('Папка результатов агента отсутствует.');
        shell.showItemInFolder(path);
      });
    },
  );
}
