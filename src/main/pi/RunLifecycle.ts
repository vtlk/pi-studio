import { relative, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { atomicJson, safePath } from '../storage/files.ts';
import { validateCompletedOutputs } from './completeStage.ts';
import type { ChannelEvent } from './RunChannel.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { searchWeb } from './webSearch.ts';
import { videoContract } from '../video/contract.ts';
import { readVideoProject } from '../video/readVideoProject.ts';
import { listProjectFiles, readProjectFile } from './projectFiles.ts';
import { closedRunStatus } from './closedRunStatus.ts';

export class RunLifecycle {
  private readonly dependencies: RunDependencies;
  constructor(dependencies: RunDependencies) {
    this.dependencies = dependencies;
  }
  async event(live: LiveRun, event: ChannelEvent) {
    live.heartbeat = Date.now();
    if (event.type === 'hello') {
      if (!Number.isSafeInteger(event.pid) || event.pid! < 2) throw new Error('Invalid process');
      live.pid = event.pid;
      await atomicJson(join(live.run.record.cwd, '.pistudio-session-lock.json'), {
        pid: live.pid,
        runId: live.run.record.runId,
      });
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
      live.ready({ runId: live.run.record.runId, project });
    } else if (event.type === 'capabilities') {
      if (typeof event.executableExtensions !== 'boolean')
        throw new Error('Invalid runtime capabilities');
      this.dependencies.capabilities?.(live.run, event.executableExtensions);
    } else if (event.type === 'opened' && this.dependencies.serviceAgent) {
      live.ready({ runId: live.run.record.runId, project: await this.dependencies.read(live.run) });
    } else if (event.type === 'request') {
      await this.dependencies.beforeRequest?.(live.run);
      live.sequence++;
      live.run.requestSequence = live.sequence;
      live.userMessage =
        typeof event.message === 'string' ? event.message.slice(0, 200_000) : undefined;
      live.completion = undefined;
      live.blocked = false;
      live.status = 'running';
      await this.dependencies.update(live.run, 'running');
    } else if (event.type === 'running') {
      live.status = 'running';
      await this.dependencies.update(live.run, 'running');
    } else if (event.type === 'settled') {
      let valid = false;
      try {
        valid =
          !!live.completion &&
          JSON.stringify(live.completion) ===
            JSON.stringify(
              await validateCompletedOutputs(
                live.run.record.output,
                live.completion.map((item) => item.path),
              ),
            );
      } catch {
        /* A deleted/changed output invalidates the completion signal. */
      }
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
      await atomicJson(
        join(live.run.projectRoot, '.pistudio/context', live.run.record.runId, 'result.json'),
        {
          runId: live.run.record.runId,
          request: live.sequence,
          status: live.status,
          outputs: valid ? live.completion : [],
        },
      );
      await this.dependencies.update(live.run, live.status);
      if (
        live.status === 'ready' &&
        live.request.autoContinue &&
        live.userMessage &&
        live.notifiedSequence !== live.sequence
      ) {
        live.notifiedSequence = live.sequence;
        const sequence = live.sequence;
        void this.dependencies
          .completed?.(live.run, live.completion!, live.userMessage)
          .catch(async () => {
            if (live.sequence !== sequence) return;
            live.status = 'waiting';
            live.blocked = true;
            await this.dependencies.update(live.run, 'waiting').catch(() => {});
          });
      }
    } else if (event.type === 'error' || event.type === 'stopped') {
      this.dependencies.closed?.(live.run);
      live.status = event.type === 'error' ? 'error' : closedRunStatus(live.status);
      await this.dependencies.update(live.run, live.status);
      live.fail(
        new Error(
          'Pi не смог открыть или продолжить диалог. Подробности доступны в его окне; ресурсы не подменялись.',
        ),
      );
    }
  }
  async tool(live: LiveRun, name: string, args: Record<string, unknown>) {
    if (name === 'web_search') return searchWeb(args.query);
    if (name === 'get_run_context') return live.run.record;
    if (name === 'list_project_files') return listProjectFiles(live.run.projectRoot, args);
    if (name === 'read_project_file') return readProjectFile(live.run.projectRoot, args);
    if (name === 'get_video_contract') return videoContract;
    if (name === 'validate_video_project') {
      if (typeof args.manifest !== 'string')
        throw new Error('Нужен путь манифеста относительно output.');
      const document = await readVideoProject(
        live.run.projectRoot,
        live.run.record.projectId,
        `${live.run.agent.outputPath}/${args.manifest}`,
      );
      return {
        validated: true,
        revision: document.revision,
        manifest: args.manifest,
        scope: document.manifest.scope,
        humanApproval: false,
        assets: document.assets.map(({ id, sha256, size }) => ({ id, sha256, size })),
      };
    }
    if (name === 'report_blocked') {
      live.blocked = true;
      await this.dependencies.update(live.run, 'waiting');
      return { paused: true };
    }
    if (name === 'complete_stage') {
      if (!live.sequence)
        throw new Error(
          'Дождитесь нового запроса пользователя в этом открытии Pi. Прошлый запрос не запускается повторно.',
        );
      live.completion = await validateCompletedOutputs(live.run.record.output, args.outputs);
      return {
        validated: true,
        outputs: live.completion,
        readyAfter: 'agent_settled',
        humanApproval: false,
      };
    }
    if (this.dependencies.tool) return this.dependencies.tool(live.run, name, args);
    throw new Error('Tool unavailable');
  }
}
