import { t } from '../../shared/i18n/index.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { dialog, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
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
