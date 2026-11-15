import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { dialog, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { LibraryKind } from '../../shared/library';
import type { StudioService } from '../storage/StudioStore';
import { withReadDeadline } from '../storage/files';
import type { ReferenceFiles } from '../pi/ReferenceFiles';
import { referenceImage } from '../pi/referenceImage';
import type { createLibraryRunHost } from '../pi/createLibraryRunHost';

export function registerLibraryHandlers(
  service: StudioService,
  references: ReferenceFiles,
  generators: ReturnType<typeof createLibraryRunHost>,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  handleDesktopInvoke(desktopChannels.listLibrary, (event) => {
    caller(event);
    return service.serialize(() =>
      withReadDeadline(async () => (await service.load()).library.list()),
    );
  });
  handleDesktopInvoke(
    desktopChannels.readLibraryCharacter,
    (event, id: string, version: number, revision: string) => {
      caller(event);
      return service.serialize(async () =>
        (await service.load()).library.character(id, version, revision),
      );
    },
  );
  handleDesktopInvoke(
    desktopChannels.createLibraryAsset,
    async (
      event,
      request: { kind: LibraryKind; agentId: string; description: string; attachments: string[] },
    ) => {
      caller(event);
      await generators.create(request);
    },
  );
  handleDesktopInvoke(desktopChannels.releaseReferenceFiles, (event, ids: unknown) => {
    caller(event);
    references.release(ids);
  });
  handleDesktopInvoke(desktopChannels.chooseReferenceFiles, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Файлы референса',
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
