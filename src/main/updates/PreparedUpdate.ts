import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  paths,
  atomicJson,
  authenticated,
  exists,
  identity,
  sameIdentity,
  readJson,
  type UpdateJob,
} from '../../../bundled/update-helper/protocol.mjs';
import type { PreparedInstallation } from './installation.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid: unknown) {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}

/** The helper has no replacement permission until commit AND actual previous-process exit. */
export class PreparedUpdate implements PreparedInstallation {
  private child?: ChildProcess;
  private ended = false;
  private started = false;
  private spawned = false;
  private disposed = false;
  private worker?: number;
  private disposal?: Promise<void>;
  private readonly job: UpdateJob;
  private readonly node: string;
  private readonly revalidate: () => Promise<void>;
  constructor(job: UpdateJob, node: string, revalidate: () => Promise<void>) {
    this.job = job;
    this.node = node;
    this.revalidate = revalidate;
  }
  async arm() {
    if (this.disposed || this.started) throw new Error('Установщик уже запущен или отменён.');
    await this.revalidate();
    const p = paths(this.job);
    if (await exists(p.active)) throw new Error('Другое обновление ещё не завершено.');
    await atomicJson(p.active, { id: this.job.id, target: this.job.target });
    const env = { ...process.env };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
    this.started = true;
    this.child = spawn(this.node, [join(this.job.stage, 'helper/runner.mjs'), p.journal], {
      cwd: this.job.userData,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env,
    });
    this.child.once('exit', () => {
      this.ended = true;
    });
    this.child.once('error', () => {
      this.ended = true;
    });
    await new Promise<void>((resolve, reject) => {
      this.child!.once('spawn', () => {
        this.spawned = true;
        resolve();
      });
      this.child!.once('error', reject);
    });
    this.child.unref();
    await atomicJson(join(this.job.stage, 'runner.json'), {
      nonce: this.job.nonce,
      pid: this.child.pid,
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (this.ended || (await authenticated(p.result, this.job))) break;
      const ready = await authenticated(p.ready, this.job);
      if (ready && typeof ready.pid === 'number' && alive(ready.pid)) {
        this.worker = ready.pid;
        return;
      }
      await sleep(40);
    }
    throw new Error('Установщик не подтвердил готовность. Прежняя версия сохранена.');
  }
  async commit() {
    const p = paths(this.job);
    if (
      !this.started ||
      this.disposed ||
      this.ended ||
      !alive(this.worker) ||
      (await authenticated(p.cancel, this.job)) ||
      (await authenticated(p.result, this.job)) ||
      !sameIdentity(await identity(this.job.target), this.job.oldIdentity)
    )
      throw new Error('Установщик больше не готов. Программа не заменена.');
    await this.revalidate();
    await atomicJson(p.commit, { nonce: this.job.nonce });
  }
  dispose() {
    if (this.disposal) return this.disposal;
    const work = this.cancel().finally(() => {
      if (this.disposal === work) this.disposal = undefined;
    });
    this.disposal = work;
    return work;
  }
  private async cancel() {
    if (this.disposed) return;
    const p = paths(this.job);
    if (this.started) {
      await atomicJson(p.cancel, { nonce: this.job.nonce });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const ready = await authenticated(p.ready, this.job);
        if (typeof ready?.pid === 'number') this.worker = ready.pid;
        const result = await authenticated(p.result, this.job);
        if (this.ended && !alive(this.worker) && (!this.spawned || result)) break;
        await sleep(40);
      }
      if (
        !this.ended ||
        alive(this.worker) ||
        (this.spawned && !(await authenticated(p.result, this.job)))
      )
        throw new Error('Не подтверждена остановка установщика. Файлы приложения сохранены.');
    }
    // Cancellation must prove that replacement never started. Never discard a recovery copy here.
    if (
      !sameIdentity(await identity(this.job.target), this.job.oldIdentity) ||
      (await exists(p.previous))
    )
      throw new Error('Замена уже началась; требуется восстановление установщика.');
    if (await exists(p.active)) {
      if ((await readJson(p.active)).id === this.job.id) await rm(p.active);
    }
    await rm(this.job.stage, { recursive: true, force: true });
    await rm(p.journal, { force: true });
    this.disposed = true;
  }
  async persist() {
    await mkdir(join(this.job.userData, 'updates/transactions'), { recursive: true, mode: 0o700 });
    await atomicJson(paths(this.job).journal, this.job);
  }
}
