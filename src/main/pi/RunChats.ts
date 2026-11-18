import type {
  ChatTarget,
  ChatSend,
  ChatAnswer,
  PiProcessInfo,
  ChatState,
} from '../../shared/chat.ts';
import { t } from '../../shared/i18n/index.ts';
import type { RunDependencies, LiveRun } from './RunTypes.ts';
import { runKey } from './RunTypes.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { EmbeddedChat } from './EmbeddedChat.ts';
import { processAlive } from './terminal.ts';
import { chatInput } from './chatInput.ts';

export class RunChats {
  private readonly embeddedProcesses = new Map<EmbeddedChat, PreparedRun>();
  private readonly retained = new Map<string, { chat: EmbeddedChat; run: PreparedRun }>();
  private readonly sending = new Set<string>();
  private readonly chatFailures = new Map<string, ChatState>();
  private readonly live: Map<string, LiveRun>;
  private readonly dependencies: RunDependencies;
  private readonly assertUnchanged: (projectId: string) => void;
  private readonly disarm: (projectId: string) => void;
  private readonly assertTarget: (target: ChatTarget) => void;
  constructor(
    live: Map<string, LiveRun>,
    dependencies: RunDependencies,
    assertUnchanged: (id: string) => void,
    disarm: (id: string) => void,
    assertTarget: (target: ChatTarget) => void = () => {},
  ) {
    this.live = live;
    this.dependencies = dependencies;
    this.assertUnchanged = assertUnchanged;
    this.disarm = disarm;
    this.assertTarget = assertTarget;
  }
  track(chat: EmbeddedChat, run: PreparedRun) {
    this.embeddedProcesses.set(chat, run);
    this.retained.set(runKey({ projectId: run.project.id, agentId: run.agent.profile.id }), {
      chat,
      run,
    });
  }
  clearFailure(key: string) {
    this.chatFailures.delete(key);
  }
  forget(target: ChatTarget) {
    this.retained.delete(runKey(target));
    this.chatFailures.delete(runKey(target));
    this.dependencies.chatChanged?.(target);
  }
  async close() {
    const results = await Promise.allSettled(
      [...this.embeddedProcesses.keys()].map((chat) => chat.stop()),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    this.embeddedProcesses.clear();
  }
  failed(request: ChatTarget, current: LiveRun | undefined, error: unknown) {
    if (!this.dependencies.embedded) return;
    this.chatFailures.set(runKey(request), {
      projectId: request.projectId,
      agentId: request.agentId,
      runId: current?.run.record.runId ?? '',
      phase: 'error',
      working: false,
      revision: 0,
      messages: current?.embedded?.snapshot().messages ?? [],
      model: current?.run.record.model.id ?? '',
      thinkingLevel: current?.run.record.model.thinkingLevel ?? '',
      error: error instanceof Error ? error.message : t('Chat.couldNotStart'),
    });
    this.dependencies.chatChanged?.(request);
  }
  processes(): PiProcessInfo[] {
    const result = new Map<number, PiProcessInfo>();
    for (const [chat, run] of this.embeddedProcesses) {
      if (!chat.alive) {
        this.embeddedProcesses.delete(chat);
        continue;
      }
      result.set(chat.child.pid!, {
        projectId: run.project.id,
        agentId: run.agent.profile.id,
        runId: run.record.runId,
        pid: chat.child.pid!,
        agentName: run.agent.profile.name,
        working: chat.state.working,
        embedded: true,
      });
    }
    for (const live of this.live.values()) {
      if (live.embedded) continue;
      if (live.pid && processAlive(live.pid) && !result.has(live.pid))
        result.set(live.pid, {
          projectId: live.run.project.id,
          agentId: live.run.agent.profile.id,
          runId: live.run.record.runId,
          pid: live.pid,
          agentName: live.run.agent.profile.name,
          working: live.status === 'running',
          embedded: !!live.embedded,
        });
    }
    return [...result.values()];
  }
  chat(target: ChatTarget) {
    return (
      this.chatFailures.get(runKey(target)) ??
      this.live.get(runKey(target))?.embedded?.snapshot() ??
      this.retained.get(runKey(target))?.chat.snapshot() ??
      null
    );
  }
  async sendChat(request: ChatSend) {
    await this.send(request);
  }
  sendAutomatic(request: ChatSend, beforeSend: (live: LiveRun) => void) {
    return this.send(request, beforeSend);
  }
  private async send(request: ChatSend, beforeSend?: (live: LiveRun) => void) {
    this.assertTarget(request);
    this.assertUnchanged(request.projectId);
    const key = runKey(request),
      live = this.live.get(key);
    if (!live?.embedded || !live.embedded.alive) throw new Error(t('Chat.disconnected'));
    if (this.sending.has(key)) throw new Error(t('Chat.sending'));
    if (live.embedded.state.phase !== 'ready') throw new Error(t('Chat.notReady'));
    if (live.embedded.state.working && !request.behavior) throw new Error(t('Chat.chooseQueue'));
    this.sending.add(key);
    try {
      const attachments = request.attachments?.length
        ? await this.dependencies.chatAttachments?.(live.run, request.attachments)
        : [];
      if (request.attachments?.length && !attachments)
        throw new Error(t('Chat.attachmentsUnavailable'));
      this.assertUnchanged(request.projectId);
      if (this.live.get(key) !== live) throw new Error(t('Chat.disconnected'));
      const input = await chatInput(live.run.projectRoot, request.text, attachments);
      this.assertTarget(request);
      beforeSend?.(live);
      return await live.embedded.send(input.message, input.images, request.behavior);
    } finally {
      this.sending.delete(key);
    }
  }
  root(target: ChatTarget) {
    return (
      this.live.get(runKey(target))?.run.projectRoot ??
      this.retained.get(runKey(target))?.run.projectRoot
    );
  }
  assertIdle(projectId?: string) {
    if ([...this.sending].some((key) => !projectId || key.startsWith(`${projectId}/`)))
      throw new Error(t('Chat.sending'));
  }
  sendingTo(projectId: string, agentId: string) {
    return this.sending.has(runKey({ projectId, agentId }));
  }
  abortChat(target: ChatTarget) {
    const live = this.live.get(runKey(target));
    if (!live?.embedded) throw new Error(t('Chat.disconnected'));
    live.request.autoContinue = false;
    this.disarm(target.projectId);
    return live.embedded.abort();
  }
  answerChat(answer: ChatAnswer) {
    this.assertUnchanged(answer.projectId);
    const chat = this.live.get(runKey(answer))?.embedded;
    if (!chat) throw new Error(t('Chat.disconnected'));
    chat.answer(answer);
  }
}
