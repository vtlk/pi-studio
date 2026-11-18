import { t } from '../../shared/i18n/index.ts';
import { projectAgentOutputPath } from '../../shared/agentPaths.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { clipboard, shell, type IpcMainInvokeEvent } from 'electron';
import { lstat } from 'node:fs/promises';
import { desktopChannels } from '../../shared/contracts';
import type { FileRequest, CopyOutputRequest, DeleteAgentDataRequest } from '../../shared/storage';
import type { StudioService } from './StudioStore';
import { safePath } from './files';
import { loadOutput } from './outputs';
import { outputScope } from './outputScope.ts';
import { readProjectScope } from './projectReadScope.ts';
import { stableId } from './validation';
import { deleteAgentData, resolveAgentDataDeletion } from './deleteAgentData';

export function registerProjectActions(
  service: StudioService,
  caller: (event: IpcMainInvokeEvent) => unknown,
  mutation: {
    change: <T>(projectId: string, action: () => Promise<T>) => Promise<T>;
    stopSession: (projectId: string, agentId: string) => Promise<void>;
    cleared: (projectId: string, agentId: string, target: DeleteAgentDataRequest['target']) => void;
  },
) {
  handleDesktopInvoke(desktopChannels.copyOutput, (event, request: CopyOutputRequest) => {
    caller(event);
    stableId(request?.projectId);
    return service.serialize(async () => {
      const root = await (await service.load()).projects.directory(request.projectId);
      const file = await loadOutput(root, request.path);
      if (!['text', 'markdown', 'json'].includes(file.format) || typeof file.content !== 'string')
        throw new Error(t('error.registerProjectActions.copyingIsAvailableOnlyFor'));
      if (!request.fingerprint || file.fingerprint !== request.fingerprint)
        throw new Error(t('error.registerProjectActions.theFileChangedSelectIt'));
      clipboard.writeText(file.content);
    });
  });
  handleDesktopInvoke(
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
          mutation.cleared(request.projectId, request.agentId, request.target);
          return store.accounting.enrich(project);
        });
      });
    },
  );
  handleDesktopInvoke(desktopChannels.revealOutput, (event, request: FileRequest) => {
    caller(event);
    stableId(request?.projectId);
    return readProjectScope(service, request.projectId, async (_store, root) => {
      await outputScope(root, request.path);
      const path = await safePath(root, request.path);
      if (!(await lstat(path)).isFile()) throw new Error(t('error.outputs.theSelectedPathIsNot'));
      return path;
    }).then((path) => shell.showItemInFolder(path));
  });
  handleDesktopInvoke(
    desktopChannels.revealAgentOutput,
    (event, request: { projectId: string; agentId: string }) => {
      caller(event);
      stableId(request?.projectId);
      stableId(request?.agentId);
      return service.serialize(async () => {
        const store = await service.load();
        const project = store.bootstrap().projects.find((item) => item.id === request.projectId);
        const agent = project?.agents.find((item) => item.profile.id === request.agentId);
        if (!agent) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
        const root = await store.projects.directory(project!.id);
        const path =
          project!.workspaceMode === 'shared'
            ? root
            : await safePath(root, projectAgentOutputPath(project!, agent));
        if (!(await lstat(path)).isDirectory())
          throw new Error(t('error.registerProjectActions.agentOutputFolderMissing'));
        shell.showItemInFolder(path);
      });
    },
  );
}
