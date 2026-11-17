import { atomicJson, isMissing, readJson } from '../storage/files.ts';
import { githubStarInterval, type GitHubStarStatus } from '../../shared/githubStar.ts';

export interface ReminderClock {
  now(): number;
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const nativeClock: ReminderClock = {
  now: () => performance.now(),
  set: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return timer;
  },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
interface Saved {
  schema: 1;
  elapsedMs: number;
  disabled: boolean;
}

/** App-wide running time only. No wall-clock timestamps, studio data or account checks. */
export class GitHubStarReminder {
  private data: Saved = { schema: 1, elapsedMs: 0, disabled: false };
  private readonly clock: ReminderClock;
  private last: number;
  private timer: unknown;
  private suspended = false;
  private closed = false;
  private generation = 0;
  private revision = 0;
  private error?: GitHubStarStatus['error'];
  private readable = true;
  private responding = false;
  private writes: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private readonly listeners = new Set<(state: GitHubStarStatus) => void>();
  private readonly file: string;
  private readonly persist: typeof atomicJson;
  private constructor(file: string, persist: typeof atomicJson, clock: ReminderClock) {
    this.clock = clock;
    this.file = file;
    this.persist = persist;
    this.last = clock.now();
  }
  static async load(
    file: string,
    options: { clock?: ReminderClock; persist?: typeof atomicJson } = {},
  ) {
    const reminder = new GitHubStarReminder(
      file,
      options.persist ?? atomicJson,
      options.clock ?? nativeClock,
    );
    try {
      const data = (await readJson(file)) as Saved;
      if (
        !data ||
        data.schema !== 1 ||
        typeof data.disabled !== 'boolean' ||
        !Number.isFinite(data.elapsedMs) ||
        data.elapsedMs < 0 ||
        data.elapsedMs > githubStarInterval
      )
        throw Error('Invalid GitHub reminder preference');
      reminder.data = { schema: 1, elapsedMs: data.elapsedMs, disabled: data.disabled };
    } catch (error) {
      if (!isMissing(error)) {
        // Optional reminders fail closed; never overwrite an unreadable opt-out.
        reminder.readable = false;
        reminder.data.disabled = true;
        reminder.error = 'read';
      }
    }
    reminder.schedule();
    return reminder;
  }
  read(): GitHubStarStatus {
    return {
      due: !this.data.disabled && this.data.elapsedMs >= githubStarInterval,
      disabled: this.data.disabled,
      revision: this.revision,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  subscribe(listener: (state: GitHubStarStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    this.revision++;
    for (const listener of this.listeners) listener(this.read());
  }
  private advance() {
    const now = this.clock.now();
    const delta = Math.max(0, now - this.last);
    this.last = now;
    if (this.suspended || this.closed || this.data.disabled) return;
    const due = this.read().due;
    this.data.elapsedMs = Math.min(githubStarInterval, this.data.elapsedMs + delta);
    this.generation++;
    if (this.read().due !== due) this.emit();
  }
  private schedule() {
    this.clock.clear(this.timer);
    if (this.closed || this.suspended || this.data.disabled || this.read().due) return;
    const remaining =
      githubStarInterval - this.data.elapsedMs - Math.max(0, this.clock.now() - this.last);
    this.timer = this.clock.set(
      () => {
        this.advance();
        void this.save().then(() => this.schedule());
      },
      Math.min(60_000, Math.max(0, remaining)),
    );
  }
  private async save(): Promise<boolean> {
    if (!this.readable) return false;
    const snapshot = { ...this.data },
      generation = this.generation;
    const write = this.writes.then(() => this.persist(this.file, snapshot));
    this.writes = write.catch(() => {});
    try {
      await write;
      if (this.generation === generation && this.error === 'write') {
        this.error = undefined;
        this.emit();
      }
      return true;
    } catch {
      if (this.generation === generation) {
        this.error = 'write';
        this.emit();
      }
      return false;
    }
  }
  async suspend() {
    this.advance();
    this.suspended = true;
    this.clock.clear(this.timer);
    await this.save();
  }
  resume() {
    this.last = this.clock.now();
    this.suspended = false;
    this.schedule();
  }
  async choose(value: unknown, open: () => Promise<unknown>): Promise<GitHubStarStatus> {
    if (value !== 'later' && value !== 'open') throw Error('Unknown GitHub reminder action');
    if (this.closed || this.responding || !this.read().due) return this.read();
    this.responding = true;
    this.advance();
    this.data = { schema: 1, elapsedMs: 0, disabled: value === 'open' };
    this.last = this.clock.now();
    this.generation++;
    this.error = undefined;
    this.emit();
    this.clock.clear(this.timer);
    try {
      const saved = await this.save();
      if (value === 'open' && saved && !this.closed) {
        try {
          await open();
        } catch {
          this.error = 'open';
          this.emit();
        }
      }
      return this.read();
    } finally {
      this.responding = false;
      this.schedule();
    }
  }
  close() {
    this.closing ??= (async () => {
      this.advance();
      this.closed = true;
      this.clock.clear(this.timer);
      await this.save();
      await this.writes;
      this.listeners.clear();
    })();
    return this.closing;
  }
}
