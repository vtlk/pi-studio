interface Entry {
  signature: string;
  value?: unknown;
  checkedAt: number;
  pending: boolean;
}
/** Bounded shared read-only checks. Old scopes and changed configurations cannot publish late results. */
export class ReadinessChecks {
  private entries = new Map<string, Entry>();
  private queue: (() => Promise<void>)[] = [];
  private active = 0;
  private closed = false;
  private readonly now: () => number;
  private readonly concurrency: number;
  constructor(now = Date.now, concurrency = 3) {
    this.now = now;
    this.concurrency = concurrency;
  }
  read<T>(
    key: string,
    signature: string,
    check: () => Promise<T>,
    fallback: T,
    ttl: number,
    force = false,
  ): T {
    let entry = this.entries.get(key);
    if (!entry || entry.signature !== signature) {
      entry = { signature, checkedAt: 0, pending: false };
      this.entries.set(key, entry);
    }
    const selected = entry;
    if (
      !this.closed &&
      !selected.pending &&
      (selected.value === undefined || force || this.now() - selected.checkedAt >= ttl)
    ) {
      selected.pending = true;
      this.queue.push(async () => {
        if (this.closed || this.entries.get(key) !== selected) return;
        let value: T;
        try {
          value = await check();
        } catch {
          value = fallback;
        }
        if (!this.closed && this.entries.get(key) === selected) {
          selected.value = value;
          selected.checkedAt = this.now();
          selected.pending = false;
        }
      });
      this.drain();
    }
    return (selected.value as T | undefined) ?? fallback;
  }
  private drain() {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      this.active++;
      void task().finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
  retain(keys: ReadonlySet<string>) {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
  }
  close() {
    this.closed = true;
    this.entries.clear();
    this.queue = [];
  }
}
