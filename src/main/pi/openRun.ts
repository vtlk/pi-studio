import { i18n, t } from '../../shared/i18n/index.ts';
import { EmbeddedChat } from './EmbeddedChat.ts';
import { reuseIdleChain } from './reuseIdleChain.ts';
import { chatInput } from './chatInput.ts';
import { validateLaunchRequest } from './validateLaunchRequest.ts';
import type { TeamDelivery } from '../team-mcp/types.ts';
import { piNode } from './platform.ts';
import { join } from 'node:path';
import { mkdir, realpath, rm } from 'node:fs/promises';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { RunChannel } from './RunChannel.ts';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { hasLiveSessionLease } from '../storage/sessionLease.ts';
import {
  runKey,
  ContinuationCancelled,
  type LiveRun,
  type RunDependencies,
  type Continuation,
} from './RunTypes.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { RunLifecycle } from './RunLifecycle.ts';
import type { RunChats } from './RunChats.ts';
import { focusRunningTerminal, openSessionTerminal, processAlive } from './terminal.ts';
import { stopRunProcess } from './stopRunProcess.ts';
import { runTerminalTitle } from './terminalTitle.ts';

export interface RunOpeningState {
  assertUnchanged: (id: string) => void;
  opening: Set<string>;
  retiring: Map<string, Promise<void>>;
  live: Map<string, LiveRun>;
  chains: Map<string, symbol>;
  dependencies: RunDependencies;
  lifecycle: RunLifecycle;
  channel: RunChannel;
  chats: RunChats;
  assertTeamDispatch: (projectId: string, agentId: string, runId: string) => void;
}
export async function openRun(
  state: RunOpeningState,
  request: LaunchAgentRequest,
  automaticMessage?: string,
  continuation?: Continuation,
  beforeDispatch?: (run: PreparedRun) => Promise<void>,
  teamDelivery?: TeamDelivery,
): Promise<LaunchAgentResult> {
  state.assertUnchanged(request.projectId);
  validateLaunchRequest(request);
  const key = runKey(request);
  continuation?.check();
  const chain = continuation?.token ?? (request.autoContinue ? Symbol() : undefined);
  if (!continuation) {
    const target = state.live.get(key);
    if (chain || (target?.chain && target.chain === state.chains.get(request.projectId)))
      state.chains.delete(request.projectId);
    if (chain) state.chains.set(request.projectId, chain);
    for (const live of state.live.values())
      if (live.run.project.id === request.projectId && (chain || live === target))
        live.request.autoContinue = false;
  }
  if (state.opening.has(key)) throw new Error(t('error.runHost.thisAgentIsAlreadyOpening'));
  state.opening.add(key);
  state.chats.clearFailure(key);
  let current: LiveRun | undefined, prepared: PreparedRun | undefined;
  let bootstrapPath: string | undefined;
  try {
    // Finish the previous process's status/lease cleanup before replacing this agent's bridge.
    await state.retiring.get(key);
    state.assertUnchanged(request.projectId);
    continuation?.check();
    const active = state.live.get(key);
    if (
      active?.embedded?.alive &&
      active.embedded.state.phase === 'ready' &&
      automaticMessage &&
      continuation &&
      !teamDelivery
    ) {
      return await reuseIdleChain(state, request, active, automaticMessage, continuation);
    }
    if (active?.embedded?.alive && active.embedded.state.phase === 'ready' && !automaticMessage) {
      if (request.firstMessage !== undefined)
        throw new Error(t('error.runHost.theAgentAlreadyHasAn'));
      active.request.autoContinue = request.autoContinue;
      active.chain = chain;
      active.continueAfterSequence = active.sequence + 1;
      return { runId: active.run.record.runId, project: await state.dependencies.read(active.run) };
    }
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
        await focusRunningTerminal(active, state.dependencies.activateTerminal);
        return {
          runId: active.run.record.runId,
          project: await state.dependencies.read(active.run),
        };
      }
      await stopRunProcess(active, state.dependencies.closed);
      await state.retiring.get(key);
    }
    if (active) {
      state.channel.remove(active.run.record.runId);
      state.live.delete(key);
    }
    const { run, piPath } = await state.dependencies.prepare(request);
    prepared = run;
    state.assertUnchanged(request.projectId);
    run.teamDelivery = teamDelivery;
    continuation?.check();
    if (run.agent.session && request.firstMessage !== undefined)
      throw new Error(t('error.runHost.theAgentAlreadyHasA'));
    const message = automaticMessage ?? request.firstMessage;
    if (
      !state.dependencies.serviceAgent &&
      !state.dependencies.embedded &&
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
          ? () => state.assertTeamDispatch(request.projectId, request.agentId, run.record.runId)
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
    state.live.set(key, live);
    const tools = state.dependencies.tools;
    const transport = await state.channel.add(
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
        serviceAgent: state.dependencies.serviceAgent,
      },
      async (event) => {
        if (event.type === 'opened') live.opened = true;
        await state.lifecycle.event(live, event);
        if (event.type === 'request' && event.messageId !== live.run.teamDelivery?.messageId)
          live.run.teamDelivery = undefined;
        await state.dependencies.observed?.(live.run, event);
      },
      (name, args, signal) => state.lifecycle.tool(live, name, args, signal),
      typeof tools === 'function' ? () => tools(run) : tools,
      state.dependencies.mcpGroups?.(run),
    );
    live.stop = () => state.channel.stop(run.record.runId);
    await mkdir(state.dependencies.bootstraps, { recursive: true, mode: 0o700 });
    const bootstrap = join(state.dependencies.bootstraps, `${run.record.runId}.json`);
    bootstrapPath = bootstrap;
    const headless = state.dependencies.headless === true;
    await atomicJson(bootstrap, {
      ...transport,
      sdk,
      headless,
      embedded: state.dependencies.embedded === true,
      language: i18n.language,
    });
    continuation?.check();
    if (teamDelivery)
      state.assertTeamDispatch(request.projectId, request.agentId, run.record.runId);
    await beforeDispatch?.(run);
    state.assertUnchanged(request.projectId);
    const timer = setTimeout(
      () => live.fail(new Error(t('error.runHost.piDidNotConfirmOpening'))),
      state.dependencies.embedded ? 120000 : 45000,
    );
    try {
      if (state.dependencies.embedded) {
        const chat = await EmbeddedChat.start(
          node,
          state.dependencies.bridge,
          bootstrap,
          request,
          run.record.runId,
          run.record.model.id,
          run.record.model.thinkingLevel,
          () => state.dependencies.chatChanged?.(request),
          () => state.assertUnchanged(request.projectId),
        );
        live.embedded = chat;
        // Track the actual child from spawn until exit, including a stalled startup/heartbeat.
        live.pid = chat.child.pid;
        state.chats.track(chat, run);
        const stop = live.stop;
        live.stop = () => {
          stop?.();
          chat.stop();
        };
        await chat.ready();
        // 'opened' is emitted only after the existing MCP readiness barrier succeeds.
        await pending;
        chat.markReady();
        if (message) {
          const input = await chatInput(run.projectRoot, message, run.record.attachments);
          await chat.send(input.message, input.images);
        }
      } else
        await (state.dependencies.openTerminal ?? openSessionTerminal)(
          node,
          state.dependencies.bridge,
          bootstrap,
          terminalTitle,
        );
      return await pending;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // A refused handoff belongs to the source chain, not to the recipient's existing chat.
    if (!(continuation && automaticMessage && !current && state.live.get(key)?.embedded?.alive))
      state.chats.failed(request, current, error);
    if (!current && prepared) state.dependencies.closed?.(prepared);
    if (current) {
      current.embedded?.stop();
      state.dependencies.closed?.(current.run);
      if (error instanceof ContinuationCancelled) {
        if (process.platform === 'win32') current.stop?.();
        else if (current.pid && processAlive(current.pid)) process.kill(current.pid, 'SIGTERM');
        state.channel.remove(current.run.record.runId);
        if (state.live.get(key) === current) state.live.delete(key);
        current.fail(error);
        throw error;
      }
      current.status = 'error';
      await state.dependencies.update(current.run, 'error');
    }
    throw error;
  } finally {
    if (bootstrapPath) await rm(bootstrapPath, { force: true }).catch(() => {});
    state.opening.delete(key);
  }
}
