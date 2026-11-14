import type { SectionSaveResult, StorageSection } from '../../../shared/storage.ts';

export interface PendingEdit {
  base: unknown;
  value: unknown;
}
interface Options {
  write: (key: StorageSection, edit: PendingEdit) => Promise<SectionSaveResult>;
  saved: (key: StorageSection, value: unknown) => void;
  conflict: (key: StorageSection) => void;
  error: (error: unknown) => void;
  changed: (pending: boolean) => void;
  settled: () => void;
}

/** Serial writes with a retained draft and an explicit stop on stale data. No merging. */
export class PersistenceQueue {
  private pending = new Map<StorageSection, PendingEdit>();
  private blocked?: StorageSection;
  private task: Promise<void> | null = null;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  get size() {
    return this.pending.size;
  }
  get writing() {
    return this.task !== null;
  }
  has(key: StorageSection) {
    return this.pending.has(key);
  }
  get(key: StorageSection) {
    return this.pending.get(key);
  }
  enqueue(key: StorageSection, value: unknown, base: unknown) {
    this.pending.set(key, { base: this.pending.get(key)?.base ?? base, value });
    this.options.changed(true);
  }
  /** Only the exact draft the user chose to replace may be discarded after a reload. */
  discard(key: StorageSection, expected: PendingEdit | undefined) {
    if (this.writing || this.pending.get(key) !== expected) return false;
    this.pending.delete(key);
    if (this.blocked === key) this.blocked = undefined;
    this.options.changed(this.size > 0);
    return true;
  }
  flush(): Promise<void> {
    if (this.task) return this.task;
    if (this.blocked || !this.size) return Promise.resolve();
    this.task = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.task = null;
        this.options.changed(this.size > 0);
      });
    return this.task;
  }
  private async drain() {
    try {
      while (this.size) {
        const [key, sent] = this.pending.entries().next().value!;
        const result = await this.options.write(key, sent);
        if (!result.saved) {
          this.blocked = key;
          this.options.conflict(key);
          return;
        }
        const latest = this.pending.get(key);
        if (latest === sent) this.pending.delete(key);
        // Typing during a write is compared with the value actually accepted by main.
        else if (latest) this.pending.set(key, { base: result.value, value: latest.value });
        this.options.saved(key, result.value);
      }
      this.options.settled();
    } catch (error) {
      this.options.error(error);
    }
  }
}
