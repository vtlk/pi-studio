import { dirname, join } from 'node:path';
import { mkdir, realpath, rm } from 'node:fs/promises';
import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import { RunChannel } from './RunChannel.ts';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { hasLiveSessionLease } from '../storage/sessionLease.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { RunLifecycle } from './RunLifecycle.ts';
import { activateSessionTerminal, openSessionTerminal, processAlive } from './terminal.ts';
import { closedRunStatus } from './closedRunStatus.ts';
import { stopRunProcess } from './stopRunProcess.ts';

class ContinuationCancelled extends Error {}
interface Continuation {
  token: symbol;
  check: () => void;
}

export class RunHost {
  private readonly channel = new RunChannel();
  private readonly live = new Map<string, LiveRun>();
  private readonly opening = new Set<string>();
  private readonly changing = new Set<string>();
  private readonly chains = new Map<string, symbol>();
  private readonly dependencies: RunDependencies;
  private readonly lifecycle: RunLifecycle;
  private monitor = setInterval(() => {
    void this.checkLiveness();
  }, 3000);
  constructor(dependencies: RunDependencies) {
    this.dependencies = dependencies;
    this.lifecycle = new RunLifecycle({
      ...dependencies,
      beforeRequest: async (run) => {
        this.assertUnchanged(run.project.id);
        const own = this.key({ projectId: run.project.id, agentId: run.agent.profile.id });
        const live = this.live.get(own);
        const automaticCheck = live?.automaticCheck;
        const check = () => {
          try {
            automaticCheck?.();
          } catch (error) {
            if (error instanceof ContinuationCancelled && live) {
              live.fail(error);
              if (live.pid && processAlive(live.pid)) process.kill(live.pid, 'SIGTERM');
            }
            throw error;
          }
        };
        check();
        if (
          [...this.live.values()].some(
            (other) =>
              other.run.project.id === run.project.id &&
              other.run.agent.profile.id !== run.agent.profile.id &&
              other.status === 'running',
          ) ||
          [...this.opening].some((key) => key.startsWith(`${run.project.id}/`) && key !== own)
        )
          throw new Error('Другой этап этого проекта ещё работает.');
        await dependencies.beforeRequest?.(run);
        this.assertUnchanged(run.project.id);
        check();
        if (live) live.automaticCheck = undefined;
      },
    });
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
  launch(request: LaunchAgentRequest) {
    return this.open(request);
  }
  continuation(run: PreparedRun) {
    const live = this.live.get(
      this.key({ projectId: run.project.id, agentId: run.agent.profile.id }),
    );
    if (
      !live ||
      live.run !== run ||
      !live.request.autoContinue ||
      !live.chain ||
      live.sequence < (live.continueAfterSequence ?? 1)
    )
      return;
    const token = live.chain,
      sequence = live.sequence;
    const check = () => {
      if (
        this.chains.get(run.project.id) !== token ||
        live.sequence !== sequence ||
        live.blocked ||
        live.status !== 'ready'
      )
        throw new ContinuationCancelled();
    };
    let used = false;
    return async (request: LaunchAgentRequest, message: string) => {
      if (used) return;
      used = true;
      try {
        if (request.projectId !== run.project.id)
          throw new Error('Цепочка не может перейти в другой проект.');
        check();
        return await this.open({ ...request, autoContinue: true }, message, { token, check });
      } catch (error) {
        if (!(error instanceof ContinuationCancelled)) throw error;
      }
    };
  }
  private async open(
    request: LaunchAgentRequest,
    automaticMessage?: string,
    continuation?: Continuation,
  ): Promise<LaunchAgentResult> {
    this.assertUnchanged(request.projectId);
    if (typeof request.autoContinue !== 'boolean') throw new Error('Некорректный режим запуска.');
    if (
      request.attachments !== undefined &&
      (!Array.isArray(request.attachments) ||
        request.attachments.length > 32 ||
        request.attachments.some((id) => typeof id !== 'string'))
    )
      throw new Error('Некорректный список референсов.');
    if (request.attachments?.length && !request.firstMessage)
      throw new Error('Референсы отправляются только вместе с первым сообщением нового диалога.');
    const key = this.key(request);
    continuation?.check();
    const chain = continuation?.token ?? (request.autoContinue ? Symbol() : undefined);
    if (!continuation) {
      this.chains.delete(request.projectId);
      if (chain) this.chains.set(request.projectId, chain);
      for (const live of this.live.values())
        if (live.run.project.id === request.projectId) live.request.autoContinue = false;
    }
    if (this.opening.has(key)) throw new Error('Этот агент уже открывается.');
    this.opening.add(key);
    let current: LiveRun | undefined;
    try {
      const active = this.live.get(key);
      if (active?.pid && processAlive(active.pid)) {
        if (request.firstMessage !== undefined)
          throw new Error(
            'У агента уже открыт диалог. Первое сообщение и референсы не отправлялись повторно.',
          );
        if (active.status === 'running') {
          if (automaticMessage)
            throw new Error('Следующий агент уже работает. Автоматическая цепочка приостановлена.');
          active.request.autoContinue = request.autoContinue;
          active.chain = chain;
          active.continueAfterSequence = active.sequence + 1;
          active.automaticCheck = undefined;
          await (this.dependencies.activateTerminal ?? activateSessionTerminal)();
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
      continuation?.check();
      if (run.agent.session && request.firstMessage !== undefined)
        throw new Error('У агента уже есть диалог. Продолжение не отправляет сообщение.');
      const message = automaticMessage ?? request.firstMessage;
      if (
        !this.dependencies.serviceAgent &&
        !run.agent.session &&
        (!message?.trim() || message.length > 200_000)
      )
        throw new Error('Введите первое сообщение.');
      const pi = await checkPi(piPath);
      if (!pi.supported) throw new Error('Для запуска требуется поддерживаемый Pi 1.5.2.');
      const sdk = await resolvePiSdk(await realpath(pi.path));
      if (await hasLiveSessionLease(run.record.cwd))
        throw new Error('Этот диалог ещё открыт в другом процессе Pi. Закройте его и повторите.');
      let sessionPath: string | undefined;
      if (run.agent.session) sessionPath = await safePath(run.projectRoot, run.agent.session.path);
      continuation?.check();
      const pending = new Promise<LaunchAgentResult>((resolve, reject) => {
        current = {
          run,
          request: { ...request },
          chain,
          continueAfterSequence: 1,
          automaticCheck: continuation?.check,
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
      const tools = this.dependencies.tools;
      const transport = await this.channel.add(
        run.record.runId,
        {
          record: run.record,
          modelAuth: run.modelAuth,
          instructions: run.instructions,
          resources: run.resources,
          sessionPath,
          fork: run.agent.session?.needsFork,
          firstMessage: message,
          serviceAgent: this.dependencies.serviceAgent,
        },
        (event) => this.lifecycle.event(live, event),
        (name, args) => this.lifecycle.tool(live, name, args),
        typeof tools === 'function' ? () => tools(run) : tools,
      );
      await mkdir(this.dependencies.bootstraps, { recursive: true, mode: 0o700 });
      const bootstrap = join(this.dependencies.bootstraps, `${run.record.runId}.json`);
      await atomicJson(bootstrap, {
        ...transport,
        sdk,
        headless: this.dependencies.headless === true,
      });
      continuation?.check();
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
        this.dependencies.closed?.(current.run);
        if (error instanceof ContinuationCancelled) {
          if (current.pid && processAlive(current.pid)) process.kill(current.pid, 'SIGTERM');
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
  private async checkLiveness() {
    for (const [key, live] of this.live)
      if ((live.pid && !processAlive(live.pid)) || Date.now() - live.heartbeat > 20000) {
        this.dependencies.closed?.(live.run);
        live.status = closedRunStatus(live.status);
        await this.dependencies.update(live.run, live.status).catch(() => {});
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
    for (const live of this.live.values()) {
      this.dependencies.closed?.(live.run);
      if (live.pid && processAlive(live.pid)) process.kill(live.pid, 'SIGTERM');
    }
    this.channel.close();
    this.live.clear();
    this.chains.clear();
  }
  assertIdle(projectId?: string) {
    if (
      (projectId ? this.changing.has(projectId) : this.changing.size > 0) ||
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
  outputsCleared(projectId: string, agentId: string) {
    this.chains.delete(projectId);
    const live = this.live.get(this.key({ projectId, agentId }));
    if (live) this.lifecycle.outputsCleared(live);
  }
  private assertUnchanged(projectId: string) {
    if (this.changing.has(projectId))
      throw new Error('Файлы проекта переносятся или копируются. Повторите позже.');
  }
  async withProjectChange<T>(projectId: string, stopSessions: boolean, action: () => Promise<T>) {
    this.assertIdle(projectId);
    this.changing.add(projectId);
    if (stopSessions) this.chains.delete(projectId);
    try {
      if (stopSessions)
        for (const live of [...this.live.values()])
          if (live.run.project.id === projectId)
            await this.stopAgent(projectId, live.run.agent.profile.id);
      return await action();
    } finally {
      this.changing.delete(projectId);
    }
  }
  async stopAgent(projectId: string, agentId: string) {
    this.chains.delete(projectId);
    const key = this.key({ projectId, agentId });
    if (this.opening.has(key)) throw new Error('Дождитесь открытия Pi перед удалением агента.');
    const live = this.live.get(key);
    if (!live) return;
    await stopRunProcess(live, this.dependencies.closed);
    this.channel.remove(live.run.record.runId);
    this.live.delete(key);
    await rm(join(live.run.record.cwd, '.pistudio-session-lock.json'), { force: true });
  }
}
