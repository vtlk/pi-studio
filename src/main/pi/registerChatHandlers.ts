import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type {
  ChatTarget,
  ChatSend,
  ChatAnswer,
  ChatReset,
  ChatQueueAction,
} from '../../shared/chat.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import type { ReferenceFile } from '../../shared/attachments.ts';
import type { AutoContinuationRequest } from '../../shared/runtime.ts';
import { t } from '../../shared/i18n/index.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { stableId } from '../storage/validation.ts';
import type { RunHost } from './RunHost.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { ChatDrafts } from './ChatDrafts.ts';
import { join } from 'node:path';
import { safePath } from '../storage/files.ts';

export function registerChatHandlers(
  service: StudioService,
  runs: RunHost,
  setup: RunHost,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
  drafts?: ChatDrafts,
  queueFiles?: { references: ReferenceFiles; directory: string },
) {
  const { references, directory: queueDirectory } = queueFiles ?? {};
  const host = (target: ChatTarget) => {
    if (!target || typeof target !== 'object') throw new Error(t('Chat.invalidRequest'));
    stableId(target.projectId);
    stableId(target.agentId);
    return target.projectId === 'pi-setup-assistant' ? setup : runs;
  };
  const scoped = async (target: ChatTarget, readOnly = false) => {
    const selected = host(target);
    const store = service.peek();
    if (!store) throw new Error(t('Chat.notReady'));
    const root =
      target.projectId === 'pi-setup-assistant'
        ? join(store.folder, '.pistudio/setup-assistant')
        : store.projects.location(target.projectId);
    if (selected.chatRoot(target) && selected.chatRoot(target) !== root)
      throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    if (!readOnly) {
      const checked =
        target.projectId === 'pi-setup-assistant'
          ? await safePath(store.folder, '.pistudio/setup-assistant', true)
          : await store.projects.directory(target.projectId);
      if (service.peek() !== store || checked !== root)
        throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    }
    return selected;
  };
  handleDesktopInvoke(desktopChannels.getChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target, true)).chat(target);
  });
  handleDesktopInvoke(
    desktopChannels.setAutoContinuation,
    async (event, request: AutoContinuationRequest) => {
      caller(event);
      (await scoped(request)).setAutoContinuation(request);
    },
  );
  handleDesktopInvoke(desktopChannels.sendChat, async (event, request: ChatSend) => {
    caller(event);
    const selected = await scoped(request);
    if (
      typeof request.text !== 'string' ||
      !request.text.trim() ||
      request.text.length > 200_000 ||
      (request.behavior !== undefined && !['steer', 'followUp'].includes(request.behavior)) ||
      (request.attachments !== undefined &&
        (!Array.isArray(request.attachments) ||
          request.attachments.length > 32 ||
          request.attachments.some((id) => typeof id !== 'string')))
    )
      throw new Error(t('Chat.invalidRequest'));
    const folder = service.peek()!.folder;
    if (
      request.draft &&
      (request.draft.folder !== folder ||
        !Number.isSafeInteger(request.draft.revision) ||
        request.draft.revision < 0)
    )
      throw Error(t('Chat.invalidRequest'));
    await selected.sendChat(request);
    if (request.draft && drafts) {
      try {
        return {
          draft: await drafts.consume(
            folder,
            request.projectId,
            request.agentId,
            request.draft.revision,
          ),
        };
      } catch {
        return { draft: { cleared: false, saveFailed: true } };
      } // The message was accepted: never report this as a failed send.
    }
    return {};
  });
  handleDesktopInvoke(desktopChannels.abortChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target)).abortChat(target);
  });
  handleDesktopInvoke(desktopChannels.closeChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target)).stopAgent(target.projectId, target.agentId);
  });
  handleDesktopInvoke(desktopChannels.resetChat, async (event, request: ChatReset) => {
    caller(event);
    stableId(request?.runId);
    return (await scoped(request)).resetChat(request);
  });
  handleDesktopInvoke(desktopChannels.changeChatQueue, async (event, request: ChatQueueAction) => {
    caller(event);
    stableId(request?.runId);
    stableId(request?.entryId);
    if (!['steer', 'edit', 'delete'].includes(request.action))
      throw Error(t('Chat.invalidRequest'));
    const selected = await scoped(request),
      store = service.peek()!;
    const staged: ReferenceFile[] = [];
    try {
      return await selected.changeChatQueue(request, async (data) => {
        const capacity = request.maxTextLength ?? 200000,
          imageCapacity = request.maxAttachments ?? 32;
        if (
          !Number.isSafeInteger(capacity) ||
          capacity < 0 ||
          capacity > 200000 ||
          !Number.isSafeInteger(imageCapacity) ||
          imageCapacity < 0 ||
          imageCapacity > 32 ||
          typeof data.text !== 'string' ||
          data.text.length > capacity ||
          (data.images !== undefined &&
            (!Array.isArray(data.images) || data.images.length > imageCapacity))
        )
          throw Error(t('Chat.queueEditTooLarge'));
        for (const image of data.images ?? []) {
          if (
            !references ||
            !queueDirectory ||
            typeof image.data !== 'string' ||
            image.data.length > 45000000 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
          )
            throw Error(t('Chat.invalidImage'));
          staged.push(
            await references.paste(Buffer.from(image.data, 'base64'), queueDirectory, store.folder),
          );
        }
        if (service.peek() !== store) throw Error(t('ChatDrafts.scopeChanged'));
        return { text: data.text, attachments: staged };
      });
    } catch (error) {
      references?.release(staged.map((file) => file.id));
      throw error;
    }
  });
  handleDesktopInvoke(desktopChannels.answerChat, async (event, answer: ChatAnswer) => {
    caller(event);
    if (
      !answer ||
      typeof answer.id !== 'string' ||
      answer.id.length > 500 ||
      (answer.value !== undefined &&
        (typeof answer.value !== 'string' || answer.value.length > 200_000)) ||
      (answer.confirmed !== undefined && typeof answer.confirmed !== 'boolean') ||
      (answer.cancelled !== undefined && typeof answer.cancelled !== 'boolean')
    )
      throw new Error(t('Chat.invalidRequest'));
    (await scoped(answer)).answerChat(answer);
  });
  handleDesktopInvoke(desktopChannels.listPiProcesses, (event) => {
    caller(event);
    return [...runs.processes(), ...setup.processes()];
  });
}
