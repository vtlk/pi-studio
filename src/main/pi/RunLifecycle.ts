import { t } from '../../shared/i18n/index.ts';
import { validStudioTerminalIdentity } from './terminal-close/windowsProfile.ts';
import { AutomaticCloseError } from './automaticClose.ts';
import { relative, join } from 'node:path';
import { stat, rm } from 'node:fs/promises';
import { atomicJson, safePath } from '../storage/files.ts';
import { validateCompletedOutputs } from './completeStage.ts';
import type { ChannelEvent } from './RunChannel.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { searchWeb } from './webSearch.ts';
import { listProjectFiles, readProjectFile } from './projectFiles.ts';
import { closedRunStatus } from './closedRunStatus.ts';
import { runFailure } from '../../shared/runFailure.ts';
import { openingFailure, openingFailureText } from '../../shared/openingFailure.ts';

export class RunLifecycle {
  outputsCleared(live: LiveRun) {
    live.status = 'idle';
    live.completion = undefined;
    live.request.autoContinue = false;
  }
  private readonly dependencies: RunDependencies;
  constructor(dependencies: RunDependencies) {
    this.dependencies = dependencies;
  }
  async processLost(live: LiveRun) {
    await this.dependencies.accountingLost?.(live.run);
    this.dependencies.activityChanged?.(live.run, false);
    this.dependencies.closed?.(live.run);
    live.status = closedRunStatus(live.status);
    await this.dependencies.update(live.run, live.status).catch(() => {});
    live.fail(new Error(t('error.runLifecycle.connectionToPiLostResult')));
    await rm(join(live.run.record.cwd, '.pistudio-session-lock.json'), { force: true }).catch(
      () => {},
    );
  }
  async event(live: LiveRun, event: ChannelEvent) {
    live.heartbeat = Date.now();
    if (event.type === 'hello') {
      if (!Number.isSafeInteger(event.pid) || event.pid! < 2) throw new Error('Invalid process');
      if (process.platform === 'win32' && !this.dependencies.headless) {
        const terminal = event.terminalIdentity;
        if (!validStudioTerminalIdentity(terminal))
          throw new Error(t('error.runLifecycle.restartWindowsTerminalToLoad'));
        live.terminalIdentity = terminal;
      }
      live.pid = event.pid;
      await atomicJson(join(live.run.record.cwd, '.pistudio-session-lock.json'), {
        pid: live.pid,
        runId: live.run.record.runId,
      });
    } else if (event.type === 'accounting') {
      await this.dependencies.accounting?.(live.run, event.usage);
    } else if (event.type === 'bound') {
      if (
        typeof event.sessionId !== 'string' ||
        !/^[a-zA-Z0-9_-]+$/.test(event.sessionId) ||
        typeof event.sessionFile !== 'string'
      )
        throw new Error('Invalid Pi binding');
      const path = relative(live.run.projectRoot, event.sessionFile).split('\\').join('/');
      const sessions = relative(live.run.projectRoot, live.run.record.sessionDirectory)
        .split('\\')
        .join('/');
      if (!path.startsWith(`${sessions}/`) || !path.endsWith('.jsonl'))
        throw new Error('Pi session is outside the agent session directory');
      await safePath(live.run.projectRoot, path);
      if (!(await stat(event.sessionFile)).isFile())
        throw new Error('Pi did not write its session');
      if (
        live.run.agent.session &&
        !live.run.agent.session.needsFork &&
        path !== live.run.agent.session.path
      )
        throw new Error('Pi replaced the bound dialogue');
      live.bound = {
        id: event.sessionId,
        path,
        title: live.run.agent.profile.name,
        createdAt: live.run.agent.session?.createdAt ?? Date.now(),
      };
      const project = await this.dependencies.update(live.run, live.status, live.bound);
      live.run.agent.session = live.bound;
      live.ready({ runId: live.run.record.runId, project });
    } else if (event.type === 'capabilities') {
      if (typeof event.executableExtensions !== 'boolean')
        throw new Error('Invalid runtime capabilities');
      this.dependencies.capabilities?.(live.run, event.executableExtensions);
    } else if (event.type === 'opened' && this.dependencies.serviceAgent) {
      live.ready({ runId: live.run.record.runId, project: await this.dependencies.read(live.run) });
    } else if (event.type === 'request') {
      const previous = live.status;
      live.status = 'running';
      try {
        await this.dependencies.beforeRequest?.(live.run);
      } catch (error) {
        live.status = previous;
        throw error;
      }
      live.sequence++;
      live.run.requestSequence = live.sequence;
      live.userMessage =
        typeof event.message === 'string' ? event.message.slice(0, 200_000) : undefined;
      live.completion = undefined;
      live.failure = undefined;
      live.blocked = false;
      live.status = 'running';
      await this.dependencies.update(live.run, 'running');
      this.dependencies.failureChanged?.(live.run);
    } else if (event.type === 'running') {
      if (event.usage) await this.dependencies.accounting?.(live.run, event.usage).catch(() => {});
      this.dependencies.activityChanged?.(live.run, true);
      live.status = 'running';
      await this.dependencies.update(live.run, 'running');
    } else if (event.type === 'settled') {
      const sequence = live.sequence;
      const completion = live.completion;
      let valid = false;
      try {
        valid =
          !!completion &&
          JSON.stringify(completion) ===
            JSON.stringify(
              await validateCompletedOutputs(
                live.run.record.output,
                completion.map((item) => item.path),
              ),
            );
      } catch {
        /* A deleted/changed output invalidates the completion signal. */
      }
      if (live.sequence !== sequence) return;
      this.dependencies.activityChanged?.(live.run, false);
      live.status =
        event.outcome === 'error'
          ? 'error'
          : event.outcome === 'aborted'
            ? 'stopped'
            : live.completion && !valid
              ? 'error'
              : valid && !live.blocked
                ? 'ready'
                : 'waiting';
      live.failure =
        live.status === 'error'
          ? event.outcome === 'error'
            ? runFailure(event.failure)
            : 'outputs'
          : undefined;
      await atomicJson(
        join(live.run.projectRoot, '.pistudio/context', live.run.record.runId, 'result.json'),
        {
          runId: live.run.record.runId,
          request: sequence,
          status: live.status,
          ...(live.failure ? { failure: live.failure } : {}),
          outputs: valid ? completion : [],
        },
      );
      if (live.sequence !== sequence) return;
      await this.dependencies.update(live.run, live.status, undefined, live.failure);
      if (live.sequence !== sequence) return;
      if (live.failure) this.dependencies.failureChanged?.(live.run, live.failure);
      if (
        live.status === 'ready' &&
        live.request.autoContinue &&
        live.userMessage &&
        live.notifiedSequence !== live.sequence
      ) {
        live.notifiedSequence = live.sequence;
        const sequence = live.sequence;
        void this.dependencies
          .completed?.(live.run, completion!, live.userMessage)
          .catch(async (error) => {
            if (live.sequence !== sequence) return;
            // The current output remains validated. Report the failed handoff
            // separately and disarm it until the next explicit Studio action.
            live.blocked = true;
            live.request.autoContinue = false;
            const failure = error instanceof AutomaticCloseError ? error.failure : 'continuation';
            if (failure === 'outputs') {
              live.status = 'error';
              await this.dependencies.update(live.run, 'error', undefined, failure).catch(() => {});
            }
            this.dependencies.failureChanged?.(
              live.run,
              failure,
              error instanceof AutomaticCloseError ? error.terminalDetail : undefined,
            );
          });
      }
    } else if (event.type === 'error' || event.type === 'stopped') {
      this.dependencies.activityChanged?.(live.run, false);
      this.dependencies.closed?.(live.run);
      live.status = event.type === 'error' ? 'error' : closedRunStatus(live.status);
      live.failure =
        live.status === 'error'
          ? (live.failure ?? runFailure(event.failure ?? 'opening'))
          : undefined;
      await this.dependencies.update(live.run, live.status, undefined, live.failure);
      if (event.type === 'error') this.dependencies.failureChanged?.(live.run, live.failure!);
      const issue = openingFailure(event.openingIssue);
      live.fail(
        new Error(issue ? openingFailureText(issue) : t('error.runLifecycle.piCouldNotOpenOr')),
      );
    }
  }
  async tool(live: LiveRun, name: string, args: Record<string, unknown>) {
    if (name === 'web_search') return searchWeb(args.query);
    if (name === 'get_run_context')
      return {
        ...live.run.record,
        ...(this.dependencies.runtimeCapabilities
          ? { runtimeCapabilities: this.dependencies.runtimeCapabilities(live.run) }
          : {}),
      };
    if (name === 'list_project_files') return listProjectFiles(live.run.projectRoot, args);
    if (name === 'read_project_file') return readProjectFile(live.run.projectRoot, args);
    if (name === 'report_blocked') {
      live.blocked = true;
      return { paused: true };
    }
    if (name === 'complete_stage') {
      if (!live.sequence) throw new Error(t('error.runLifecycle.waitForANewUser'));
      const sequence = live.sequence;
      const ensureCurrent = () => {
        if (live.sequence !== sequence || live.status !== 'running')
          throw new Error(t('error.runLifecycle.theCompletionSignalBelongsTo'));
      };
      ensureCurrent();
      const completion = await validateCompletedOutputs(live.run.record.output, args.outputs);
      ensureCurrent();
      live.completion = completion;
      return {
        validated: true,
        outputs: live.completion,
        readyAfter: 'agent_settled',
      };
    }
    if (this.dependencies.tool) return this.dependencies.tool(live.run, name, args);
    throw new Error('Tool unavailable');
  }
}
