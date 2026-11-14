import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CuaRuntime } from './CuaRuntime.ts';
import { cuaVersion, type ComputerState } from '../../shared/computer.ts';
import { computerMcp } from '../../shared/builtinResources.ts';
import { atomicJson } from '../storage/files.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { ResourceCheck } from '../../shared/resources.ts';
import type { SessionMcpGroup, SessionMcpResult, SessionTool } from '../pi/RunChannel.ts';

type Runtime = Pick<CuaRuntime, 'tools' | 'permissions' | 'call' | 'release' | 'close'>;
const statusTool: SessionTool = {
  name: 'check_permissions',
  description:
    'Read Computer Use readiness. Never prompts for permissions or performs desktop actions. Missing permissions do not prevent normal text work.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const failed = (text: string): SessionMcpResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});
interface Binding {
  controller: AbortController;
  session: string;
  group: SessionMcpGroup;
}

/** One host runtime shared by every project/helper/library dialogue, with private per-open leases. */
export class ComputerSupport {
  private readonly runtime: Runtime;
  private readonly bindings = new Map<string, Binding>();
  private readonly retiring = new Set<Promise<void>>();
  private closing?: Promise<void>;
  constructor(runtime: Runtime = new CuaRuntime()) {
    this.runtime = runtime;
  }
  async state(): Promise<ComputerState> {
    try {
      const permissions = await this.runtime.permissions();
      return {
        version: cuaVersion,
        permissions,
        phase:
          permissions.accessibility && permissions.screenRecording
            ? 'ready'
            : 'permissions_required',
      };
    } catch {
      return {
        version: cuaVersion,
        phase: 'unavailable',
        message: 'Компонент Computer Use недоступен. Переустановите текущую версию Pi Studio.',
      };
    }
  }
  async check(): Promise<ResourceCheck> {
    return {
      status: (await this.state()).phase === 'ready' ? 'available' : 'unavailable',
      checkedAt: Date.now(),
    };
  }
  async bind(run: PreparedRun, visual: boolean) {
    if (this.closing || this.bindings.has(run.record.runId))
      throw new Error('Computer Use: диалог уже закрывается или подключён.');
    const tools = await this.runtime.tools().catch(() => [statusTool]);
    if (this.closing) throw new Error('Computer Use закрывается.');
    const controller = new AbortController(),
      session = `studio-${randomUUID()}`;
    const group: SessionMcpGroup = {
      name: 'pi_studio_computer',
      tools: visual ? tools : [statusTool],
      call: async (name, args, requestSignal) => {
        if (controller.signal.aborted || this.closing)
          return failed('Диалог Computer Use закрыт. Запрос не выполнен.');
        if (name === 'check_permissions') {
          if (Object.keys(args).length)
            return failed('Параметры запроса разрешений недоступны агенту.');
          return { content: [{ type: 'text', text: JSON.stringify(await this.state()) }] };
        }
        if (!visual) return failed('Computer Use требует модель с поддержкой изображений.');
        try {
          return await this.runtime.call(
            session,
            name,
            args,
            AbortSignal.any([controller.signal, requestSignal]),
          );
        } catch {
          return failed(
            'Computer Use не подтвердил результат действия. Автоматического повтора или переключения в foreground нет. Получите свежий снимок перед следующим действием.',
          );
        }
      },
    };
    this.bindings.set(run.record.runId, { controller, session, group });
    run.record.resourceIds.mcps = [...new Set([...run.record.resourceIds.mcps, computerMcp.id])];
    try {
      await atomicJson(
        join(run.projectRoot, '.pistudio/context', run.record.runId, 'context.json'),
        run.record,
      );
    } catch (error) {
      this.release(run);
      throw error;
    }
  }
  groups(run: PreparedRun) {
    const group = this.bindings.get(run.record.runId)?.group;
    return group ? [group] : [];
  }
  private retire(id: string) {
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    binding.controller.abort();
    const task = this.runtime.release(binding.session).catch(() => {});
    this.retiring.add(task);
    void task.finally(() => this.retiring.delete(task));
  }
  release(run: PreparedRun) {
    this.retire(run.record.runId);
  }
  drain() {
    this.closing ??= (async () => {
      for (const id of this.bindings.keys()) this.retire(id);
      await Promise.allSettled([...this.retiring]);
      await this.runtime.close();
    })();
    return this.closing;
  }
  close() {
    void this.drain().catch(() => {});
  }
}
