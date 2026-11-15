import { dispatchTeamMessage } from './dispatch.ts';
import { projectCaller } from './projectCaller.ts';
import type { TeamMessageAction } from '../../shared/teamMessages.ts';
import { observeAttention } from './attention.ts';
import { queryTeam } from './queryTeam.ts';
import { waitForTeamMessage } from './wait.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { SessionMcpGroup, ChannelEvent } from '../pi/RunChannel.ts';
import type { ModelConnectionStatus } from '../../shared/connections.ts';
import { hasModelConfiguration } from '../../shared/modelConfiguration.ts';
import { teamScope, recipient } from './scope.ts';
import { teamTools } from './tools.ts';
import { TeamJournal, messageHash, messageId } from './TeamJournal.ts';
import { verifyReceipt } from './receipt.ts';
import { publicMessage, type TeamHost, type TeamCaller } from './types.ts';

export class TeamSupport {
  private host?: TeamHost;
  private stopping = false;
  private readonly journals = new Map<string, TeamJournal>();
  private readonly armed = new Set<string>();
  private readonly pumping = new Set<string>();
  private readonly contexts = new Map<string, TeamCaller>();
  private timer = setInterval(() => {
    for (const run of this.contexts.values()) void this.pump(run).catch(() => {});
  }, 2000);
  private service: StudioService;
  private check?: (folder: string, connectionId: string) => Promise<ModelConnectionStatus>;
  constructor(
    service: StudioService,
    check?: (folder: string, connectionId: string) => Promise<ModelConnectionStatus>,
  ) {
    this.service = service;
    this.check = check;
    this.timer.unref();
  }
  attach(host: TeamHost) {
    this.host = host;
  }
  assertUpdateIdle() {
    if (this.armed.size || this.pumping.size)
      throw new Error('Дождитесь выполнения или отмените ожидающие поручения команды.');
  }
  drain() {
    this.close();
    return Promise.resolve();
  }
  close() {
    this.stopping = true;
    clearInterval(this.timer);
    this.armed.clear();
    this.contexts.clear();
  }
  private journal(run: TeamCaller) {
    const key = `${run.projectRoot}/${run.project.id}`;
    let journal = this.journals.get(key);
    if (!journal) {
      journal = new TeamJournal(run.projectRoot, run.project.id);
      this.journals.set(key, journal);
    }
    return journal;
  }
  async projectMessages(projectId: string) {
    const run = await projectCaller(this.service, projectId);
    await this.reconcile(run);
    return (await this.journal(run).list()).map((item) =>
      publicMessage(item, this.armed.has(item.id)),
    );
  }
  async manageMessage(request: TeamMessageAction) {
    if (!request || !['resume', 'cancel'].includes(request.action))
      throw new Error('Некорректное действие с поручением.');
    let run = await projectCaller(this.service, request.projectId);
    const journal = this.journal(run),
      item = await journal.get(request.messageId);
    if (!item) throw new Error('Поручение отсутствует.');
    if (request.action === 'cancel') {
      const active = this.host?.inspect(item.projectId, item.recipientId);
      if (
        ['dispatching', 'received'].includes(item.state) ||
        (active?.run.record.runId === item.runId && active?.status === 'running')
      )
        throw new Error(
          'Получатель ещё работает. Завершите его запрос в Pi; отмена очереди его не прерывает.',
        );
      if (!['queued', 'uncertain', 'failed'].includes(item.state))
        throw new Error('Поручение уже завершено.');
      await journal.update(item.id, (previous) => {
        if (!['queued', 'uncertain', 'failed'].includes(previous.state))
          throw new Error('Поручение уже принято получателем или завершено.');
        return {
          ...previous,
          state: 'cancelled',
          reason: 'Отменено пользователем; повтор не выполняется.',
        };
      });
      this.armed.delete(item.id);
    } else {
      if (item.state !== 'queued')
        throw new Error(
          'Возобновлять можно только недоставленное поручение. Неопределённая доставка не повторяется.',
        );
      run = await projectCaller(this.service, request.projectId, item.senderId);
      const scope = await teamScope(this.service, run);
      if (scope.project.sourceTeamId !== item.sourceTeamId)
        throw new Error('Исходная команда изменилась.');
      recipient(scope, { agent_id: item.recipientId });
      this.armed.add(item.id);
      this.contexts.set(`${run.projectRoot}/${run.project.id}`, run);
      void this.pump(run).catch(() => {});
    }
  }
  groups(run: PreparedRun): SessionMcpGroup[] {
    if (!run.teamAccess) return [];
    return [
      {
        name: 'team',
        tools: teamTools,
        call: async (name, args, signal) => {
          if (signal.aborted) throw new Error('Вызов отменён.');
          let result = await this.call(run, name, args);
          if (name === 'say_to' || name === 'say_to_agent') {
            const accepted = result as { id: string };
            result = await waitForTeamMessage(this.journal(run), this.armed, accepted.id, signal);
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            ...(['say_to', 'say_to_agent'].includes(name) &&
            (result as { state?: string }).state !== 'completed'
              ? { isError: true }
              : {}),
          };
        },
      },
    ];
  }
  async call(run: TeamCaller, name: string, args: Record<string, unknown>) {
    if (this.stopping) throw new Error('Studio закрывается; новые поручения не отправляются.');
    if (!run.teamAccess) throw new Error('MCP team не назначен этому открытию.');
    // Service/library workspaces must never select a project implicitly.
    if (!run.project.sourceTeamId)
      throw new Error('team требует привязки к открытому проекту и его исходной команде.');
    const scope = await teamScope(this.service, run);
    if (['list_agents', 'message_status', 'say_to', 'say_to_agent'].includes(name))
      await this.reconcile(run);
    if (!['say_to', 'say_to_agent'].includes(name))
      return queryTeam(
        this.service,
        run,
        scope,
        name,
        args,
        this.journal(run),
        this.armed,
        this.host,
        this.check,
      );
    const { current, saved } = recipient(scope, args);
    const conflict = this.host?.teamUnavailable(scope.project.id, current.id);
    if (conflict?.includes('цепочка'))
      throw new Error(
        'Поручение не отправлено: включена цепочка проекта. Сначала явно завершите или выключите её; team не заменяет её задание.',
      );
    if (
      !hasModelConfiguration(current.model) ||
      !scope.connections.some(
        (item) => item.id === current.model?.connectionId && item.purpose !== 'images',
      )
    )
      throw new Error('Подключение, модель или уровень рассуждения получателя не настроены.');
    if (
      typeof args.request_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(args.request_id) ||
      typeof args.text !== 'string' ||
      !args.text.trim() ||
      args.text.length > 190000
    )
      throw new Error('Нужны text и стабильный request_id (буквы/цифры/_/-).');
    const lineage = [...(run.teamDelivery?.lineage ?? []), run.record.agentId];
    if (lineage.includes(current.id))
      throw new Error('Самопосылка и циклы передачи team запрещены.');
    const now = Date.now();
    const item = await this.journal(run).accept({
      version: 1,
      id: messageId(scope.project.id, run.record.agentId, args.request_id),
      requestId: args.request_id,
      projectId: scope.project.id,
      sourceTeamId: scope.team!.id,
      senderId: run.record.agentId,
      recipientId: current.id,
      createdAt: now,
      updatedAt: now,
      state: 'queued',
      text: args.text,
      bodyHash: messageHash(args.text),
      lineage,
      expectedSession: saved.session
        ? { id: saved.session.id, path: saved.session.path }
        : undefined,
    });
    if (item.state === 'queued') {
      this.armed.add(item.id);
      this.contexts.set(`${run.projectRoot}/${scope.project.id}`, run);
      void this.pump(run).catch(() => {});
    }
    return publicMessage(item, this.armed.has(item.id));
  }
  private async reconcile(run: TeamCaller) {
    const journal = this.journal(run);
    for (const item of await journal.list()) {
      if (!['dispatching', 'received'].includes(item.state)) continue;
      const key = `${run.projectRoot}/${run.project.id}/${item.recipientId}`;
      const active = this.host?.inspect(item.projectId, item.recipientId);
      if (this.pumping.has(key) || active?.run.record.runId === item.runId) continue;
      await journal.update(item.id, (previous) =>
        ['dispatching', 'received'].includes(previous.state)
          ? {
              ...previous,
              state: previous.state === 'received' ? 'failed' : 'uncertain',
              reason: 'Предыдущее открытие Pi завершилось без подтверждения. Повтор не выполнен.',
            }
          : previous,
      );
    }
  }
  private async pump(run: TeamCaller) {
    if (!this.host || this.stopping) return;
    const journal = this.journal(run);
    const seen = new Set<string>();
    for (const item of await journal.list()) {
      if (
        !['queued', 'dispatching', 'received', 'uncertain'].includes(item.state) ||
        seen.has(item.recipientId)
      )
        continue;
      seen.add(item.recipientId);
      if (item.state === 'dispatching' && Date.now() - item.updatedAt > 60000)
        await journal.update(item.id, (previous) =>
          previous.state === 'dispatching'
            ? {
                ...previous,
                state: 'uncertain',
                reason: 'Приём Pi не подтверждён за 60 секунд. Повтор не выполнен.',
              }
            : previous,
        );
      if (item.state !== 'queued' || !this.armed.has(item.id)) continue;
      const key = `${run.projectRoot}/${run.project.id}/${item.recipientId}`;
      if (this.pumping.has(key)) continue;
      this.pumping.add(key);
      void dispatchTeamMessage(this.service, this.host, run, item, journal)
        .then(async () => {
          if ((await journal.get(item.id))?.state !== 'queued') this.armed.delete(item.id);
        })
        .catch(() => {})
        .finally(() => this.pumping.delete(key));
    }
  }
  async event(run: PreparedRun, event: ChannelEvent) {
    await observeAttention(run, event, this.host);
    const delivery = run.teamDelivery;
    if (!delivery) return;
    const journal = this.journal(run);
    const item = await journal.get(delivery.messageId);
    if (!item || item.runId !== run.record.runId) return;
    if (event.type === 'team_received') {
      if (event.messageId !== item.id) throw new Error('Неверный team receipt.');
      await verifyReceipt(run, item, event.entryId, item.dispatchHash!);
      await journal.update(item.id, (previous) =>
        ['dispatching', 'uncertain'].includes(previous.state)
          ? {
              ...previous,
              state: 'received',
              sessionId: run.agent.session!.id,
              sessionPath: run.agent.session!.path,
              entryId: event.entryId,
              reason: undefined,
            }
          : previous,
      );
      // Other already queued tasks accepted before the first dialogue existed bind to this exact session.
      for (const queued of await journal.list())
        if (
          queued.state === 'queued' &&
          queued.recipientId === item.recipientId &&
          !queued.expectedSession
        )
          await journal.update(queued.id, (previous) => ({
            ...previous,
            expectedSession: { id: run.agent.session!.id, path: run.agent.session!.path },
          }));
    } else if (event.type === 'settled' && item.state === 'received') {
      const state = this.host?.inspect(run.project.id, run.record.agentId);
      await journal.update(item.id, (previous) => ({
        ...previous,
        state: state?.status === 'ready' ? 'completed' : 'failed',
        reason:
          state?.status === 'ready'
            ? undefined
            : 'Запрос завершён без подтверждённого complete_stage; проверьте диалог получателя.',
      }));
    } else if (
      ['stopped', 'error'].includes(event.type) &&
      ['dispatching', 'received'].includes(item.state)
    ) {
      await journal.update(item.id, (previous) => ({
        ...previous,
        state: previous.state === 'received' ? 'failed' : 'uncertain',
        reason: 'Диалог закрылся; повтор не выполнен.',
      }));
    }
  }
}
