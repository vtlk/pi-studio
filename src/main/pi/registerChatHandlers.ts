import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { desktopChannels } from '../../shared/contracts';
import type { ChatTarget, ChatSend, ChatAnswer } from '../../shared/chat.ts';
import { t } from '../../shared/i18n/index.ts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { stableId } from '../storage/validation.ts';
import type { RunHost } from './RunHost.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { safePath } from '../storage/files.ts';

export function registerChatHandlers(
  service: StudioService,
  runs: RunHost,
  setup: RunHost,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  const host = (target: ChatTarget) => {
    if (!target || typeof target !== 'object') throw new Error(t('Chat.invalidRequest'));
    stableId(target.projectId);
    stableId(target.agentId);
    return target.projectId === 'pi-setup-assistant' ? setup : runs;
  };
  const scoped = async (target: ChatTarget) => {
    const selected = host(target);
    await service.serialize(async () => {
      const store = await service.load();
      const root =
        target.projectId === 'pi-setup-assistant'
          ? await safePath(store.folder, '.pistudio/setup-assistant', true)
          : await store.projects.directory(target.projectId);
      if (selected.chatRoot(target) && selected.chatRoot(target) !== root)
        throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    });
    return selected;
  };
  handleDesktopInvoke(desktopChannels.getChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target)).chat(target);
  });
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
    return selected.sendChat(request);
  });
  handleDesktopInvoke(desktopChannels.abortChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target)).abortChat(target);
  });
  handleDesktopInvoke(desktopChannels.closeChat, async (event, target: ChatTarget) => {
    caller(event);
    return (await scoped(target)).stopAgent(target.projectId, target.agentId);
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
