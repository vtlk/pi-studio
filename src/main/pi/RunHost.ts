import { dirname, join, relative } from 'node:path';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { AgentRunStatus, SessionBinding, WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { RunChannel, type ChannelEvent } from './RunChannel.ts';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { atomicJson, safePath, readJson, isMissing } from '../storage/files.ts';
import { validateCompletedOutputs } from './completeStage.ts';
import { activateSessionTerminal, openSessionTerminal, processAlive } from './terminal.ts';

interface Dependencies {
  bootstraps: string;
  bridge: string;
  prepare: (request: LaunchAgentRequest) => Promise<{ run: PreparedRun; piPath: string }>;
  update: (
    run: PreparedRun,
    status: AgentRunStatus,
    session?: SessionBinding,
  ) => Promise<WorkspaceProject>;
  read: (run: PreparedRun) => Promise<WorkspaceProject>;
  openTerminal?: typeof openSessionTerminal;
  headless?: boolean;
}
interface LiveRun {
  run: PreparedRun;
  request: LaunchAgentRequest;
  pid?: number;
  status: AgentRunStatus;
  sequence: number;
  completion?: Awaited<ReturnType<typeof validateCompletedOutputs>>;
  blocked: boolean;
  bound?: SessionBinding;
  heartbeat: number;
  ready: (result: LaunchAgentResult) => void;
  fail: (error: Error) => void;
}
export class RunHost {
  private readonly channel = new RunChannel();
  private readonly live = new Map<string, LiveRun>();
  private readonly opening = new Set<string>();
  private readonly dependencies: Dependencies;
  private monitor = setInterval(() => {
    void this.checkLiveness();
  }, 3000);
  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.monitor.unref();
  }
  get connected() {
    return [...this.live.values()].some(
      (live) => live.pid && processAlive(live.pid) && Date.now() - live.heartbeat < 20000,
    );
  }
  private key(request: Pick<LaunchAgentRequest, 'projectId' | 'agentId'>) {
    return `${request.projectId}/${request.agentId}`;
  }
  async launch(request: LaunchAgentRequest): Promise<LaunchAgentResult> {
    const key = this.key(request);
    if (this.opening.has(key)) throw new Error('Этот агент уже открывается.');
    this.opening.add(key);
    let current: LiveRun | undefined;
    try {
      const active = this.live.get(key);
      if (active?.pid && processAlive(active.pid)) {
        if (active.status === 'running') {
          await activateSessionTerminal();
          return {
            runId: active.run.record.runId,
            project: await this.dependencies.read(active.run),
          };
        }
        process.kill(active.pid, 'SIGTERM');
        for (let i = 0; i < 100 && processAlive(active.pid); i++)
          await new Promise((resolve) => setTimeout(resolve, 50));
        if (processAlive(active.pid))
          throw new Error(
            'Предыдущий Pi ещё закрывается. Повторите открытие через несколько секунд.',
          );
        this.channel.remove(active.run.record.runId);
        this.live.delete(key);
      } else if (active) {
        this.channel.remove(active.run.record.runId);
        this.live.delete(key);
      }
      const { run, piPath } = await this.dependencies.prepare(request);
      if (run.agent.session && request.firstMessage !== undefined)
        throw new Error('У агента уже есть диалог. Продолжение не отправляет сообщение.');
      if (
        !run.agent.session &&
        (!request.firstMessage?.trim() || request.firstMessage.length > 200_000)
      )
        throw new Error('Введите первое сообщение.');
      const pi = await checkPi(piPath);
      if (!pi.supported) throw new Error('Для запуска требуется поддерживаемый Pi 1.5.2.');
      const sdk = await resolvePiSdk(await realpath(pi.path));
      const lock = join(run.record.cwd, '.pistudio-session-lock.json');
      try {
        const lease = (await readJson(lock)) as { pid?: number; runId?: string };
        if (lease.pid && processAlive(lease.pid)) {
          const { stdout } = await promisify(execFile)('/bin/ps', [
            '-p',
            String(lease.pid),
            '-o',
            'command=',
          ]);
          if (lease.runId && stdout.includes('/session.mjs') && stdout.includes(lease.runId))
            throw new Error(
              'Этот диалог ещё открыт в другом процессе Pi. Закройте его и повторите.',
            );
        }
      } catch (error) {
        if (!isMissing(error) && error instanceof Error && error.message.startsWith('Этот диалог'))
          throw error;
      }
      let sessionPath: string | undefined;
      if (run.agent.session) sessionPath = await safePath(run.projectRoot, run.agent.session.path);
      const pending = new Promise<LaunchAgentResult>((resolve, reject) => {
        current = {
          run,
          request,
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
      this.live.set(key, live);
      const transport = await this.channel.add(
        run.record.runId,
        {
          record: run.record,
          instructions: run.instructions,
          resources: run.resources,
          sessionPath,
          fork: run.agent.session?.needsFork,
          firstMessage: request.firstMessage,
        },
        (event) => this.event(live, event),
        (name, args) => this.tool(live, name, args),
      );
      await mkdir(this.dependencies.bootstraps, { recursive: true, mode: 0o700 });
      const bootstrap = join(this.dependencies.bootstraps, `${run.record.runId}.json`);
      await atomicJson(bootstrap, {
        ...transport,
        sdk,
        headless: this.dependencies.headless === true,
      });
      await (this.dependencies.openTerminal ?? openSessionTerminal)(
        join(dirname(pi.path), 'node'),
        this.dependencies.bridge,
        bootstrap,
      );
      const timer = setTimeout(
        () =>
          live.fail(
            new Error(
              'Pi не подтвердил открытие диалога. Проверьте окно Terminal и настройки ресурсов.',
            ),
          ),
        45000,
      );
      try {
        return await pending;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (current) {
        current.status = 'error';
        await this.dependencies.update(current.run, 'error');
      }
      throw error;
    } finally {
      this.opening.delete(key);
    }
  }
  private async event(live: LiveRun, event: ChannelEvent) {
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
      if (
        !path.startsWith(`agents/${live.run.record.agentId}/sessions/`) ||
        !path.endsWith('.jsonl')
      )
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
    } else if (event.type === 'request') {
      live.sequence++;
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
    } else if (event.type === 'error' || event.type === 'stopped') {
      live.status =
        event.type === 'error' ? 'error' : live.status === 'running' ? 'stopped' : live.status;
      await this.dependencies.update(live.run, live.status);
      live.fail(
        new Error(
          'Pi не смог открыть или продолжить диалог. Подробности доступны в его окне; ресурсы не подменялись.',
        ),
      );
    }
  }
  private async tool(live: LiveRun, name: string, args: Record<string, unknown>) {
    if (name === 'get_run_context') return live.run.record;
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
    throw new Error('Tool unavailable');
  }
  private async checkLiveness() {
    for (const [key, live] of this.live)
      if ((live.pid && !processAlive(live.pid)) || Date.now() - live.heartbeat > 20000) {
        if (live.status === 'running')
          await this.dependencies.update(live.run, 'stopped').catch(() => {});
        this.channel.remove(live.run.record.runId);
        this.live.delete(key);
        live.fail(new Error('Связь с Pi потеряна. Готовность результата не подтверждена.'));
        await rm(join(live.run.record.cwd, '.pistudio-session-lock.json'), { force: true }).catch(
          () => {},
        );
      }
  }
  close() {
    clearInterval(this.monitor);
    for (const live of this.live.values())
      if (live.pid && processAlive(live.pid)) process.kill(live.pid, 'SIGTERM');
    this.channel.close();
    this.live.clear();
  }
  assertIdle(projectId?: string) {
    if (
      this.opening.size ||
      [...this.live.values()].some(
        (live) =>
          (!projectId || live.run.record.projectId === projectId) && live.status === 'running',
      )
    )
      throw new Error(
        'Дождитесь завершения или остановите работающий Pi перед изменением папки проекта/студии.',
      );
  }
  async stopAgent(projectId: string, agentId: string) {
    const key = this.key({ projectId, agentId });
    if (this.opening.has(key)) throw new Error('Дождитесь открытия Pi перед удалением агента.');
    const live = this.live.get(key);
    if (!live) return;
    if (live.pid && processAlive(live.pid)) {
      process.kill(live.pid, 'SIGTERM');
      for (let i = 0; i < 100 && processAlive(live.pid); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (processAlive(live.pid))
        throw new Error('Pi ещё закрывается. Агент не удалён; повторите через несколько секунд.');
    }
    this.channel.remove(live.run.record.runId);
    this.live.delete(key);
    await rm(join(live.run.record.cwd, '.pistudio-session-lock.json'), { force: true });
  }
}
