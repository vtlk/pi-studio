import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ChatDrafts } from './ChatDrafts.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { desktopChannels } from '../../shared/contracts.ts';
import type { ChatDraftSave } from '../../shared/chatDrafts.ts';
import { t } from '../../shared/i18n/index.ts';
export function registerChatDrafts(
  service: StudioService,
  references: ReferenceFiles,
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  const drafts = new ChatDrafts(app.getPath('userData'), references, (change) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send(desktopChannels.chatDraftConsumed, change);
  });
  handleDesktopInvoke(
    desktopChannels.loadChatDrafts,
    async (event, request: { folder: string }) => {
      caller(event);
      const store = service.peek();
      if (
        !store ||
        typeof request?.folder !== 'string' ||
        (request.folder !== store.folder && !drafts.authorized(request.folder))
      )
        throw Error(t('ChatDrafts.scopeChanged'));
      if (request.folder === store.folder) drafts.authorize(store.folder);
      return { folder: request.folder, drafts: await drafts.load(request.folder) };
    },
  );
  handleDesktopInvoke(desktopChannels.saveChatDraft, (event, request: ChatDraftSave) => {
    caller(event);
    return drafts.save(request);
  });
  return drafts;
}
