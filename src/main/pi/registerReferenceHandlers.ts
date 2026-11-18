import { isAbsolute, join } from 'node:path';
import { copyAgentFiles } from '../storage/copyAgentFiles';
import { stableId } from '../storage/validation';
import { t } from '../../shared/i18n/index.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { app, dialog, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { StudioService } from '../storage/StudioStore';
import type { ReferenceFiles } from './ReferenceFiles';
import { referenceImage } from './referenceImage';

export function registerReferenceHandlers(
  service: StudioService,
  references: ReferenceFiles,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  handleDesktopInvoke(desktopChannels.releaseReferenceFiles, (event, ids: unknown) => {
    caller(event);
    references.release(ids);
  });
  handleDesktopInvoke(desktopChannels.stageDroppedFiles, async (event, paths: unknown) => {
    caller(event);
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > 32 ||
      paths.some((path) => typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
    )
      throw new Error(t('Chat.invalidRequest'));
    const folder = (service.peek() ?? (await service.serialize(() => service.load()))).folder;
    return references.select(paths, folder);
  });
  handleDesktopInvoke(
    desktopChannels.stageClipboardImage,
    async (event, request: { bytes: ArrayBuffer }) => {
      caller(event);
      if (!(request?.bytes instanceof ArrayBuffer) || request.bytes.byteLength > 32 * 1024 ** 2)
        throw new Error(t('Chat.invalidImage'));
      const folder = (service.peek() ?? (await service.serialize(() => service.load()))).folder;
      const image = nativeImage.createFromBuffer(Buffer.from(request.bytes));
      if (image.isEmpty()) throw new Error(t('Chat.invalidImage'));
      const file = await references.paste(
        new Uint8Array(request.bytes),
        join(app.getPath('userData'), 'runtime/pasted-images'),
        folder,
      );
      return {
        ...file,
        preview: image.resize({ width: 120, height: 120, quality: 'good' }).toDataURL(),
      };
    },
  );
  handleDesktopInvoke(
    desktopChannels.importAgentFiles,
    (event, request: { projectId: string; agentId: string; ids: string[] }) => {
      caller(event);
      stableId(request?.projectId);
      stableId(request?.agentId);
      return service.serialize(async () => {
        const store = await service.load();
        const project = store
          .bootstrap()
          .projects.find((project) => project.id === request.projectId);
        const agent = project?.agents.find((agent) => agent.profile.id === request.agentId);
        if (!project || !agent)
          throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
        const items = references.validate(request.ids, store.folder, true);
        return copyAgentFiles(await store.projects.directory(project.id), project, agent, items);
      });
    },
  );
  handleDesktopInvoke(desktopChannels.chooseReferenceFiles, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: t('ReferenceAttachments.referenceFiles'),
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    const folder = await service.serialize(async () => (await service.load()).folder);
    const files = await references.select(result.filePaths, folder);
    return Promise.all(
      files.map(async (file, index) => {
        if (!file.type.startsWith('image/')) return file;
        try {
          const png = await referenceImage(result.filePaths[index], file.type),
            image = nativeImage.createFromBuffer(png);
          return {
            ...file,
            preview: image.resize({ width: 120, height: 120, quality: 'good' }).toDataURL(),
          };
        } catch {
          return file;
        }
      }),
    );
  });
}
