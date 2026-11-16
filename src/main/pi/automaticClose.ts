import { terminalCloseDetail, type TerminalCloseDetail } from '../../shared/runFailure.ts';
import { runTerminalTitle } from './terminalTitle.ts';
import { captureWindowsTab } from './terminal-close/windowsTerminal.ts';
import type { TerminalIdentity } from '../../shared/runtime.ts';
import { join } from 'node:path';
import { stat, rm } from 'node:fs/promises';
import type { PreparedRun } from './ContextBuilder.ts';
import type { LiveRun, RunDependencies } from './RunTypes.ts';
import { ContinuationCancelled, runKey } from './RunTypes.ts';
import { processAlive } from './terminal.ts';
import { readJson, isMissing, safePath } from '../storage/files.ts';
import { validateCompletedOutputs } from './completeStage.ts';
import { captureMacTab } from './terminal-close/macTerminal.ts';

export interface TerminalCloseHandle {
  verify(): Promise<void>;
  close(): Promise<void>;
}
export class AutomaticCloseError extends Error {
  readonly failure: 'terminal_close' | 'outputs';
  readonly terminalDetail?: TerminalCloseDetail;
  constructor(message: string, failure: AutomaticCloseError['failure'] = 'terminal_close', terminalDetail?: TerminalCloseDetail) {
    super(message);
    this.failure = failure;
    this.terminalDetail = terminalDetail;
  }
}
export async function captureOwnedTab(
  pid: number,
  runId: string,
  bridge: string,
  identity?: TerminalIdentity,
  title?: string,
): Promise<TerminalCloseHandle> {
  if (process.platform === 'darwin') return captureMacTab(pid, runId, bridge, title ?? '');
  return captureWindowsTab(pid, runId, bridge, identity);
}

export function closeSuccessfulRun(
  run: PreparedRun,
  sequence: number,
  check: () => void,
  state: {
    live: Map<string, LiveRun>;
    retiring: Map<string, Promise<void>>;
    dependencies: RunDependencies;
    removeChannel: (id: string) => void;
  },
) {
  const key = runKey({ projectId: run.project.id, agentId: run.agent.profile.id });
  const live = state.live.get(key);
  check();
  if (!live || live.run !== run)
    throw new AutomaticCloseError(
      'Связь с завершённым запуском Pi потеряна. Автоматического закрытия и повтора нет.',
    );
  if (
    !live.request.autoContinue ||
    live.blocked ||
    live.status !== 'ready' ||
    live.sequence !== sequence ||
    live.autoCloseSequence === sequence
  )
    throw new ContinuationCancelled();
  if (!live.bound || !live.completion || state.retiring.has(key))
    throw new AutomaticCloseError(
      'История или окончание работы Pi ещё не подтверждены. Цепочка приостановлена.',
    );
  live.autoCloseSequence = sequence;
  const pid = live.pid;
  const cleanup = (async () => {
    try {
      await state.dependencies.beforeAutomaticClose?.(run);
      check();
      const session = await safePath(run.projectRoot, live.bound!.path);
      if (!(await stat(session)).isFile())
        throw new AutomaticCloseError('История Pi не сохранена; автоматическое закрытие отменено.');
      check();
      const capture = state.dependencies.captureTerminal ?? captureOwnedTab;
      const handle = state.dependencies.headless
        ? undefined
        : pid
          ? await capture(
              pid,
              run.record.runId,
              state.dependencies.bridge,
              live.terminalIdentity,
              runTerminalTitle(run),
            )
          : undefined;
      if (!state.dependencies.headless && !handle)
        throw new AutomaticCloseError('Точное окно Pi недоступно; другие окна не закрывались.');
      const outputs = await validateCompletedOutputs(
        run.record.output,
        live.completion!.map((item) => item.path),
      );
      if (JSON.stringify(outputs) !== JSON.stringify(live.completion))
        throw new AutomaticCloseError(
          'Результат изменился после завершения. Окно Pi не закрывалось.',
          'outputs',
        );
      check();
      if (pid && processAlive(pid)) await handle?.verify();
      check();
      // Authenticated shutdown belongs to this run; never signal a possibly reused PID.
      live.stop?.();
      for (let i = 0; pid && processAlive(pid) && i < 200; i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (pid && processAlive(pid))
        throw new AutomaticCloseError(
          'Pi ещё закрывается. Принудительного завершения и повторной передачи нет.',
        );
      check();
      await handle?.close();
      check();
      const lock = join(run.record.cwd, '.pistudio-session-lock.json');
      try {
        const lease = (await readJson(lock)) as { runId?: string; pid?: number };
        if (lease.runId === run.record.runId && lease.pid === pid) await rm(lock, { force: true });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      state.dependencies.closed?.(run);
      state.removeChannel(run.record.runId);
    } catch (error) {
      check(); // A new request/cancellation takes priority over a stale close error.
      if (error instanceof AutomaticCloseError) throw error;
      throw new AutomaticCloseError(
        error instanceof Error ? error.message : 'Не удалось подтвердить закрытие Pi.',
        'terminal_close',
        error && typeof error === 'object' && 'terminalDetail' in error ? terminalCloseDetail(error.terminalDetail) : undefined,
      );
    }
  })();
  state.retiring.set(key, cleanup);
  return cleanup.finally(() => {
    if (state.retiring.get(key) === cleanup) state.retiring.delete(key);
  });
}
