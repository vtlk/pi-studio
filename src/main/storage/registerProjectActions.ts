import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { lstat } from 'node:fs/promises';
import { desktopChannels } from '../../shared/contracts';
import type { FileRequest, CopyOutputRequest, DeleteAgentDataRequest } from '../../shared/storage';
import type { StudioService } from './StudioStore';
import { safePath } from './files';
import { loadOutput } from './outputs';
import { stableId } from './validation';
import { deleteAgentData, resolveAgentDataDeletion } from './deleteAgentData';

export function registerProjectActions(
  service: StudioService,
  caller: (event: IpcMainInvokeEvent) => unknown,
  mutation: {
    change: <T>(projectId: string, action: () => Promise<T>) => Promise<T>;
    stopSession: (projectId: string, agentId: string) => Promise<void>;
    cleared: (projectId: string, agentId: string) => void;
  },
) {
  ipcMain.handle(desktopChannels.copyOutput, (event, request: CopyOutputRequest) => {
    caller(event);
    stableId(request?.projectId);
    return service.serialize(async () => {
      const root = await (await service.load()).projects.directory(request.projectId);
      const file = await loadOutput(root, request.path);
      if (!['text', 'markdown', 'json'].includes(file.format) || typeof file.content !== 'string')
        throw new Error('Копирование доступно только для текстовых файлов.');
      if (!request.fingerprint || file.fingerprint !== request.fingerprint)
        throw new Error('Файл изменился. Выберите его заново и повторите копирование.');
      clipboard.writeText(file.content);
    });
  });
  ipcMain.handle(
    desktopChannels.deleteAgentData,
    async (event, request: DeleteAgentDataRequest) => {
      caller(event);
      stableId(request?.projectId);
      stableId(request?.agentId);
      return mutation.change(request.projectId, async () => {
        if (request.target !== 'files') {
          await service.serialize(async () => {
            await resolveAgentDataDeletion(await service.load(), request);
          });
          // Pi's final event uses the service queue too; stop outside it to avoid a deadlock.
          await mutation.stopSession(request.projectId, request.agentId);
        }
        return service.serialize(async () => {
          const store = await service.load();
          const project = await deleteAgentData(store, request, (path) => shell.trashItem(path));
          mutation.cleared(request.projectId, request.agentId);
          return store.accounting.enrich(project);
        });
      });
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
