import { i18n, t } from '../../shared/i18n/index.ts';
import { checkRunLiveness } from './runLiveness.ts';
import { RunUpdateGuard } from './RunUpdateGuard.ts';
import { withRunProjectChange } from './runProjectChange.ts';
import { closeSuccessfulRun } from './automaticClose.ts';
import { validateLaunchRequest } from './validateLaunchRequest.ts';
import { runTeamAccess } from './runTeamAccess.ts';
import { runContinuation } from './runContinuation.ts';
import type { TeamDelivery } from '../team-mcp/types.ts';
import { piNode } from './platform.ts';
import { join } from 'node:path';
import { mkdir, realpath, rm } from 'node:fs/promises';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import { RunChannel } from './RunChannel.ts';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { hasLiveSessionLease } from '../storage/sessionLease.ts';
import { hasConnectedRun, runKey, type LiveRun, type RunDependencies } from './RunTypes.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { RunLifecycle } from './RunLifecycle.ts';
import { focusRunningTerminal, openSessionTerminal, processAlive } from './terminal.ts';
import { stopRunProcess, drainRunProcesses, closeRuns } from './stopRunProcess.ts';
import { assertRunsIdle } from './assertRunsIdle.ts';
import { runTerminalTitle } from './terminalTitle.ts';
import { ContinuationCancelled, type Continuation } from './RunTypes.ts';
export class RunHost {
  private stopping = false;
  private readonly channel = new RunChannel();
  private readonly live = new Map<string, LiveRun>();
  private readonly opening = new Set<string>();
  private readonly retiring = new Map<string, Promise<void>>();
  private readonly changing = new Set<string>();
  private readonly chains = new Map<string, symbol>();
  readonly updates = new RunUpdateGuard(this, this.live, this.chains, () => this.stopping);
  private readonly dependencies: RunDependencies;
  private readonly lifecycle: RunLifecycle;
  private monitor = setInterval(() => void this.checkLiveness(), 3000);
  constructor(dependencies: RunDependencies) {
    this.dependencies = dependencies;
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
  launch = (request: LaunchAgentRequest) => this.open(request);
  launchServiceTask(
    request: LaunchAgentRequest,
    message: string,
    beforeDispatch?: () => Promise<void>,
  ) {
    if (!this.dependencies.serviceAgent || !message.trim() || message.length > 200_000)
      throw new Error(t('error.runHost.invalidServiceTask'));
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
  private async open(
    request: LaunchAgentRequest,
    automaticMessage?: string,
    continuation?: Continuation,
    beforeDispatch?: (run: PreparedRun) => Promise<void>,
    teamDelivery?: TeamDelivery,
  ): Promise<LaunchAgentResult> {
    this.assertUnchanged(request.projectId);
    validateLaunchRequest(request);
    const key = runKey(request);
    continuation?.check();
    const chain = continuation?.token ?? (request.autoContinue ? Symbol() : undefined);
    if (!continuation) {
      const target = this.live.get(key);
      if (chain || (target?.chain && target.chain === this.chains.get(request.projectId)))
        this.chains.delete(request.projectId);
      if (chain) this.chains.set(request.projectId, chain);
      for (const live of this.live.values())
        if (live.run.project.id === request.projectId && (chain || live === target))
          live.request.autoContinue = false;
    }
    if (this.opening.has(key)) throw new Error(t('error.runHost.thisAgentIsAlreadyOpening'));
    this.opening.add(key);
    let current: LiveRun | undefined, prepared: PreparedRun | undefined;
    try {
      // Finish the previous process's status/lease cleanup before replacing this agent's bridge.
      await this.retiring.get(key);
      this.assertUnchanged(request.projectId);
      continuation?.check();
      const active = this.live.get(key);
      if (active?.pid && processAlive(active.pid)) {
        if (automaticMessage && !teamDelivery && active.chain !== chain)
          throw new Error(t('error.runHost.theNextAgentSDialogue'));
        if (request.firstMessage !== undefined)
          throw new Error(t('error.runHost.theAgentAlreadyHasAn'));
        if (active.status === 'running') {
          if (automaticMessage) throw new Error(t('error.runHost.theNextAgentIsAlready'));
          active.request.autoContinue = request.autoContinue;
          active.chain = chain;
          active.continueAfterSequence = active.sequence + 1;
          active.automaticCheck = undefined;
          await focusRunningTerminal(active, this.dependencies.activateTerminal);
          return {
            runId: active.run.record.runId,
            project: await this.dependencies.read(active.run),
          };
        }
        await stopRunProcess(active, this.dependencies.closed);
        await this.retiring.get(key);
      }
      if (active) {
        this.channel.remove(active.run.record.runId);
        this.live.delete(key);
      }
      const { run, piPath } = await this.dependencies.prepare(request);
      prepared = run;
      this.assertUnchanged(request.projectId);
      run.teamDelivery = teamDelivery;
      continuation?.check();
      if (run.agent.session && request.firstMessage !== undefined)
        throw new Error(t('error.runHost.theAgentAlreadyHasA'));
      const message = automaticMessage ?? request.firstMessage;
      if (
        !this.dependencies.serviceAgent &&
        !run.agent.session &&
        (!message?.trim() || message.length > 200_000)
      )
        throw new Error(t('error.runHost.enterTheFirstMessage'));
      const pi = await checkPi(piPath);
      if (!pi.supported) throw new Error(t('error.runHost.launchingRequiresTheSupportedPi'));
      const sdk = await resolvePiSdk(await realpath(pi.path));
      const node = await piNode(pi.path);
      if (await hasLiveSessionLease(run.record.leaseDirectory ?? run.record.cwd))
        throw new Error(t('error.runHost.thisDialogueIsStillOpen'));
      let sessionPath: string | undefined;
      if (run.agent.session) sessionPath = await safePath(run.projectRoot, run.agent.session.path);
      continuation?.check();
      const pending = new Promise<LaunchAgentResult>((resolve, reject) => {
        current = {
          run,
          request: { ...request },
          chain,
          continueAfterSequence: 1,
          automaticCheck: teamDelivery
            ? () => this.assertTeamDispatch(request.projectId, request.agentId, run.record.runId)
            : continuation?.check,
          status: 'waiting',
          sequence: 0,
          blocked: false,
          heartbeat: Date.now(),
          ready: resolve,
          fail: reject,
        };
      });
      void pending.catch(() => {});
      const live = current!;
      const terminalTitle = runTerminalTitle(run);
      this.live.set(key, live);
      const tools = this.dependencies.tools;
      const transport = await this.channel.add(
        run.record.runId,
        {
          terminalTitle,
          teamAccess: run.teamAccess,
          teamDelivery,
          record: run.record,
          modelAuth: run.modelAuth,
          instructions: run.instructions,
          resources: run.resources,
          sessionPath,
          fork: run.agent.session?.needsFork,
          firstMessage: message,
          serviceAgent: this.dependencies.serviceAgent,
        },
        async (event) => {
          await this.lifecycle.event(live, event);
          if (event.type === 'opened') live.opened = true;
          if (event.type === 'request' && event.messageId !== live.run.teamDelivery?.messageId)
            live.run.teamDelivery = undefined;
          await this.dependencies.observed?.(live.run, event);
        },
        (name, args) => this.lifecycle.tool(live, name, args),
        typeof tools === 'function' ? () => tools(run) : tools,
        this.dependencies.mcpGroups?.(run),
      );
      live.stop = () => this.channel.stop(run.record.runId);
      await mkdir(this.dependencies.bootstraps, { recursive: true, mode: 0o700 });
      const bootstrap = join(this.dependencies.bootstraps, `${run.record.runId}.json`);
      const headless = this.dependencies.headless === true;
      await atomicJson(bootstrap, { ...transport, sdk, headless, language: i18n.language });
      continuation?.check();
      if (teamDelivery)
        this.assertTeamDispatch(request.projectId, request.agentId, run.record.runId);
      await beforeDispatch?.(run);
      this.assertUnchanged(request.projectId);
      await (this.dependencies.openTerminal ?? openSessionTerminal)(
        node,
        this.dependencies.bridge,
        bootstrap,
        terminalTitle,
      );
      const timer = setTimeout(
        () => live.fail(new Error(t('error.runHost.piDidNotConfirmOpening'))),
        45000,
      );
      try {
        return await pending;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (!current && prepared) this.dependencies.closed?.(prepared);
      if (current) {
        this.dependencies.closed?.(current.run);
        if (error instanceof ContinuationCancelled) {
          if (process.platform === 'win32') current.stop?.();
          else if (current.pid && processAlive(current.pid)) process.kill(current.pid, 'SIGTERM');
          this.channel.remove(current.run.record.runId);
          if (this.live.get(key) === current) this.live.delete(key);
          current.fail(error);
          throw error;
        }
        current.status = 'error';
        await this.dependencies.update(current.run, 'error');
      }
      throw error;
    } finally {
      this.opening.delete(key);
    }
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
    this.channel.close();
    this.live.clear();
    this.chains.clear();
  }
  assertIdle(projectId?: string) {
    const { changing, opening, retiring, live } = this;
    assertRunsIdle(changing, opening, retiring.keys(), live.values(), projectId);
  }
  outputsCleared(projectId: string, agentId: string) {
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
