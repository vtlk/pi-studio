import { t } from '../../shared/i18n/index.ts';
import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke';
import type { StudioService } from '../storage/StudioStore';
import type { Startup } from './Startup';
import { checkPi } from './checkPi';

export function registerStartupHandlers(
  service: StudioService,
  startup: Startup,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  handleDesktopInvoke(desktopChannels.getStartup, (event) => {
    caller(event);
    return startup.read();
  });
  handleDesktopInvoke(desktopChannels.retryStartup, (event) => {
    caller(event);
    return startup.retry();
  });
  handleDesktopInvoke(desktopChannels.skipStartup, (event) => {
    caller(event);
    return startup.skip();
  });
  handleDesktopInvoke(desktopChannels.chooseStartupPi, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: t('registerStartupHandlers.chooseInstalledPi'),
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const state = await startup.choose(result.filePaths[0]);
    await service.serialize(async () =>
      (await service.load()).saveSection('piPath', state.pi!.path),
    );
    return state;
  });
  handleDesktopInvoke(desktopChannels.checkPi, (event, path: string) => {
    caller(event);
    return service.serialize(() => checkPi(path || startup.path));
  });
}
