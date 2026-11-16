import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import {
  paths,
  loadJob,
  exists,
  readJson,
  identity,
  sameIdentity,
  executable,
  atomicJson,
  authenticated,
  type UpdateJob,
} from '../../../bundled/update-helper/protocol.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export interface StartupUpdateState {
  phase: 'starting' | 'committed' | 'restored' | 'aborting' | 'recovery-required';
  message?: string;
}
interface Options {
  appRoot: string;
  executable: string;
  version: string;
  userData: string;
  argv: string[];
  quit(): void;
}

/** A replacement starts frozen and may acknowledge health only after real main/renderer readiness. */
export class UpdateStartup {
  readonly job: UpdateJob;
  private state: StartupUpdateState;
  private timer?: ReturnType<typeof setInterval>;
  private acknowledged = false;
  private checking = false;
  private quitting = false;
  private readonly quit: () => void;
  constructor(job: UpdateJob, phase: 'starting' | 'restored' | 'committed', quit: () => void) {
    this.job = job;
    this.quit = quit;
    this.state =
      phase === 'restored'
        ? { phase: 'restored', message: 'Обновление не запустилось. Восстановлена прежняя версия.' }
        : phase === 'committed'
          ? { phase }
          : { phase, message: 'Проверяем запуск обновлённой Studio…' };
  }
  read() {
    return { ...this.state };
  }
  async start() {
    if (this.state.phase !== 'starting') return;
    const p = paths(this.job);
    // Keep the marker until actual process exit. Removing it on will-quit would race rollback.
    await atomicJson(join(p.startups, `${process.pid}.json`), {
      nonce: this.job.nonce,
      pid: process.pid,
      version: this.job.version,
      exe: executable(this.job.target, this.job.platform),
    });
    await this.poll();
    if (this.state.phase !== 'starting') return;
    this.timer = setInterval(() => {
      void this.poll().catch(() => this.abort());
    }, 100);
    this.timer.unref();
  }
  /** Caller must first flush main state and receive a saved, hydrated, frozen-renderer acknowledgement. */
  async confirmReady() {
    if (this.state.phase !== 'starting' || this.acknowledged) return;
    await this.poll();
    if (this.state.phase !== 'starting') return;
    if (!sameIdentity(await identity(this.job.target), this.job.newIdentity))
      throw new Error('Папка обновлённой программы изменилась до проверки запуска.');
    this.acknowledged = true;
    try {
      await atomicJson(paths(this.job).health, {
        nonce: this.job.nonce,
        pid: process.pid,
        version: this.job.version,
        exe: executable(this.job.target, this.job.platform),
      });
    } catch (error) {
      this.acknowledged = false;
      throw error;
    }
  }
  async poll() {
    if (this.checking || this.state.phase !== 'starting') return;
    this.checking = true;
    try {
      const p = paths(this.job);
      if (await authenticated(p.abort, this.job)) {
        this.abort();
        return;
      }
      const result = await authenticated(p.result, this.job);
      if (!result) return;
      if (result.status === 'committed') {
        if (
          !this.acknowledged ||
          !sameIdentity(await identity(this.job.target), this.job.newIdentity)
        )
          throw new Error('Не подтверждён запуск установленной версии.');
        this.state = { phase: 'committed' };
        this.close();
      } else if (result.status === 'recovery-required') {
        this.state = {
          phase: 'recovery-required',
          message: 'Обновление не завершено. Прежняя программа сохранена для восстановления.',
        };
        this.close();
      } else this.abort();
    } finally {
      this.checking = false;
    }
  }
  private abort() {
    this.state = {
      phase: 'aborting',
      message: 'Запуск обновления отменён. Возвращаем прежнюю версию…',
    };
    this.close();
    if (!this.quitting) {
      this.quitting = true;
      this.quit();
    }
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** An argv override is accepted only with a matching private, path-bound transaction. */
export async function resolveUpdateStartup(options: Options) {
  const explicit = options.argv.filter((value) => /^--pistudio-update(?:-failed)?=/.test(value));
  const overrides = options.argv.filter((value) => value.startsWith('--pistudio-user-data='));
  if (explicit.length > 1 || overrides.length > 1 || (!!overrides.length && !explicit.length))
    throw new Error('Неоднозначный запуск установщика.');
  if (!explicit.length && !overrides.length && !(await exists(options.userData)))
    return { userData: options.userData };
  const restored = explicit[0]?.startsWith('--pistudio-update-failed=') ?? false;
  let id = explicit[0]?.slice(explicit[0].indexOf('=') + 1);
  const userData = await realpath(
    overrides[0]?.slice('--pistudio-user-data='.length) ?? options.userData,
  );
  if (!id) {
    const active = join(userData, 'updates/active.json');
    if (!(await exists(active))) return { userData };
    const pointer = await readJson(active);
    if (pointer.target !== options.appRoot || typeof pointer.id !== 'string')
      throw new Error('Не совпадает путь незавершённого обновления.');
    id = pointer.id;
  }
  if (!uuid.test(id)) throw new Error('Некорректный идентификатор обновления.');
  const job = await loadJob(join(userData, 'updates/transactions', `${id}.json`));
  const p = paths(job);
  const pointer = await readJson(p.active);
  if (
    job.userData !== userData ||
    job.target !== options.appRoot ||
    options.executable !== executable(job.target, job.platform) ||
    pointer.id !== id ||
    pointer.target !== job.target
  )
    throw new Error('Установщик не относится к запущенной программе.');
  const current = await identity(job.target);
  const result = await authenticated(p.result, job);
  let phase: 'starting' | 'restored' | 'committed' = 'starting';
  if (restored || (!explicit.length && sameIdentity(current, job.oldIdentity))) {
    if (
      !sameIdentity(current, job.oldIdentity) ||
      options.version !== job.oldVersion ||
      !['rolled-back', 'failed'].includes(String(result?.status))
    )
      throw new Error('Не подтверждено восстановление прежней программы.');
    phase = 'restored';
  } else if (!sameIdentity(current, job.newIdentity) || options.version !== job.version)
    throw new Error('Установщик ещё заменяет программу. Дождитесь автоматического запуска.');
  else if (result?.status === 'committed') phase = 'committed';
  return { userData, startup: new UpdateStartup(job, phase, options.quit) };
}
