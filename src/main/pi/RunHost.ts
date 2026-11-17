import { t } from '../../shared/i18n/index.ts';
import { RunChats } from './RunChats.ts';
import { openRun } from './openRun.ts';
import type { ChatTarget, ChatSend, ChatAnswer } from '../../shared/chat.ts';
import { checkRunLiveness } from './runLiveness.ts';
import { RunUpdateGuard } from './RunUpdateGuard.ts';
import { withRunProjectChange } from './runProjectChange.ts';
import { closeSuccessfulRun } from './automaticClose.ts';
import { runTeamAccess } from './runTeamAccess.ts';
import { runContinuation } from './runContinuation.ts';
import type { TeamDelivery } from '../team-mcp/types.ts';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import { RunChannel } from './RunChannel.ts';
import { hasConnectedRun, runKey, type LiveRun, type RunDependencies } from './RunTypes.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { RunLifecycle } from './RunLifecycle.ts';
import { processAlive } from './terminal.ts';
import { stopRunProcess, drainRunProcesses, closeRuns } from './stopRunProcess.ts';
import { assertRunsIdle } from './assertRunsIdle.ts';
import { ContinuationCancelled, type Continuation } from './RunTypes.ts';
export class RunHost {
  private stopping = false;
  private readonly channel = new RunChannel();
  private readonly live = new Map<string, LiveRun>();
  private readonly opening = new Set<string>();
  private readonly chats: RunChats;
  private readonly retiring = new Map<string, Promise<void>>();
  private readonly changing = new Set<string>();
  private readonly chains = new Map<string, symbol>();
  readonly updates = new RunUpdateGuard(this, this.live, this.chains, () => this.stopping);
  private readonly dependencies: RunDependencies;
  private readonly lifecycle: RunLifecycle;
  private monitor = setInterval(() => void this.checkLiveness(), 3000);
  constructor(dependencies: RunDependencies) {
    this.dependencies = dependencies;
    this.chats = new RunChats(
      this.live,
      dependencies,
      (id) => this.assertUnchanged(id),
      (id) => this.chains.delete(id),
    );
    this.lifecycle = new RunLifecycle({
      ...dependencies,
      beforeRequest: async (run) => {
        this.assertUnchanged(run.project.id);
        const own = runKey({ projectId: run.project.id, agentId: run.agent.profile.id });
        const live = this.live.get(own);
        const automaticCheck = live?.automaticCheck;
        const check = () => {
          try {
            automaticCheck?.();
          } catch (error) {
            if (error instanceof ContinuationCancelled && live) {
              live.fail(error);
              if (process.platform === 'win32') live.stop?.();
              else if (live.pid && processAlive(live.pid)) process.kill(live.pid, 'SIGTERM');
            }
            throw error;
          }
        };
        check();
        await dependencies.beforeRequest?.(run);
        this.assertUnchanged(run.project.id);
        check();
        if (live) live.automaticCheck = undefined;
      },
    });
    this.monitor.unref();
  }
  get connected() {
    return hasConnectedRun(this.live.values(), processAlive);
  }
  processes = () => this.chats.processes();
  chat = (target: ChatTarget) => this.chats.chat(target);
  chatRoot = (target: ChatTarget) => this.chats.root(target);
  sendChat = (request: ChatSend) => this.chats.sendChat(request);
  abortChat = (target: ChatTarget) => this.chats.abortChat(target);
  answerChat = (answer: ChatAnswer) => this.chats.answerChat(answer);
  launch = (request: LaunchAgentRequest) => {
    this.dependencies.chatOpened?.(request);
    return this.open(request);
  };
  launchServiceTask(
    request: LaunchAgentRequest,
    message: string,
    beforeDispatch?: () => Promise<void>,
  ) {
    if (!this.dependencies.serviceAgent || !message.trim() || message.length > 200_000)
      throw new Error(t('error.runHost.invalidServiceTask'));
    this.dependencies.chatOpened?.(request);
    return this.open(request, message, undefined, beforeDispatch);
  }
  continuation(run: PreparedRun) {
    return runContinuation(run, {
      live: this.live,
      chains: this.chains,
      open: (request, message, continuation) => this.open(request, message, continuation),
    });
  }
  private readonly teamAccess = runTeamAccess({
    live: this.live,
    chains: this.chains,
    changing: this.changing,
    opening: this.opening,
    retiring: this.retiring,
    assertUnchanged: (id) => this.assertUnchanged(id),
    open: (request, text, before, delivery) =>
      this.open(request, text, undefined, before, delivery),
  });
  inspect = this.teamAccess.inspect.bind(this.teamAccess);
  teamUnavailable = this.teamAccess.teamUnavailable.bind(this.teamAccess);
  assertTeamDispatch = this.teamAccess.assertTeamDispatch.bind(this.teamAccess);
  launchTeamTask = this.teamAccess.launchTeamTask.bind(this.teamAccess);
  closeCompleted(run: PreparedRun, sequence: number, check: () => void) {
    return closeSuccessfulRun(run, sequence, check, {
      live: this.live,
      retiring: this.retiring,
      dependencies: this.dependencies,
      removeChannel: (id) => this.channel.remove(id),
    });
  }
  private open(
    request: LaunchAgentRequest,
    automaticMessage?: string,
    continuation?: Continuation,
    beforeDispatch?: (run: PreparedRun) => Promise<void>,
    teamDelivery?: TeamDelivery,
  ): Promise<LaunchAgentResult> {
    return openRun(
      {
        assertUnchanged: (id) => this.assertUnchanged(id),
        opening: this.opening,
        retiring: this.retiring,
        live: this.live,
        chains: this.chains,
        dependencies: this.dependencies,
        lifecycle: this.lifecycle,
        channel: this.channel,
        chats: this.chats,
        assertTeamDispatch: this.assertTeamDispatch,
      },
      request,
      automaticMessage,
      continuation,
      beforeDispatch,
      teamDelivery,
    );
  }
  private checkLiveness() {
    return checkRunLiveness({
      live: this.live,
      retiring: this.retiring,
      lifecycle: this.lifecycle,
      opening: this.opening,
      dependencies: this.dependencies,
      remove: (id) => this.channel.remove(id),
    });
  }
  drain() {
    this.stopping = true;
    clearInterval(this.monitor);
    this.chains.clear();
    return drainRunProcesses(this.live.values(), this.dependencies);
  }
  close() {
    this.stopping = true;
    clearInterval(this.monitor);
    closeRuns(this.live.values(), this.dependencies);
    this.chats.close();
    this.channel.close();
    this.live.clear();
    this.chains.clear();
  }
  assertIdle(projectId?: string) {
    this.chats.assertIdle(projectId);
    const { changing, opening, retiring, live } = this;
    assertRunsIdle(changing, opening, retiring.keys(), live.values(), projectId);
  }
  outputsCleared(projectId: string, agentId: string, dialogueCleared = false) {
    if (dialogueCleared) this.chats.forget({ projectId, agentId });
    this.chains.delete(projectId);
    const live = this.live.get(runKey({ projectId, agentId }));
    if (live) this.lifecycle.outputsCleared(live);
  }
  private assertUnchanged(projectId: string) {
    this.updates.assertOpen();
    if (this.stopping) throw new Error(t('error.runHost.studioIsClosingNoNew'));
    if (this.changing.has(projectId)) throw new Error(t('error.runHost.projectFilesAreBeingMoved'));
  }
  async withProjectChange<T>(projectId: string, stopSessions: boolean, action: () => Promise<T>) {
    return withRunProjectChange(
      { changing: this.changing, chains: this.chains, live: this.live },
      projectId,
      stopSessions,
      () => this.assertIdle(projectId),
      (agentId) => this.stopAgent(projectId, agentId),
      action,
    );
  }
  async stopAgent(projectId: string, agentId: string) {
    this.chains.delete(projectId);
    const key = runKey({ projectId, agentId });
    if (this.opening.has(key)) throw new Error(t('error.runHost.waitForPiToOpen'));
    await this.retiring.get(key);
    const live = this.live.get(key);
    if (!live) return;
    await stopRunProcess(live, this.dependencies.closed);
    await this.dependencies.accountingLost?.(live.run);
    await this.retiring.get(key);
    this.channel.remove(live.run.record.runId);
    this.live.delete(key);
    const lease = live.run.record.leaseDirectory ?? live.run.record.cwd;
    await rm(join(lease, '.pistudio-session-lock.json'), { force: true });
  }
}
