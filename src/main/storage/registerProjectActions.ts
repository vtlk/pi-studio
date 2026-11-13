import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { lstat } from 'node:fs/promises';
import { desktopChannels } from '../../shared/contracts';
import type { FileRequest } from '../../shared/storage';
import type { StudioService } from './StudioStore';
import { safePath } from './files';
import { loadOutput } from './outputs';
import { stableId } from './validation';

export function registerProjectActions(
  service: StudioService,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
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
