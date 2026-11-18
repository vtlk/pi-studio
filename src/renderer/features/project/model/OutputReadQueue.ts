/** Coalesce changing file fingerprints, keeping each completed preview while the next is read. */
export class OutputReadQueue<T> {
  private wanted?: string;
  private completed?: string;
  private task?: Promise<void>;
  private closed = false;
  private readonly load: () => Promise<T>;
  private readonly result: (file?: T, error?: unknown) => void;
  constructor(load: () => Promise<T>, result: (file?: T, error?: unknown) => void) {
    this.load = load;
    this.result = result;
  }
  request(version: string) {
    this.wanted = version;
    if (!this.closed && !this.task && this.wanted !== this.completed) {
      this.task = this.drain().finally(() => {
        this.task = undefined;
        if (!this.closed && this.wanted !== this.completed) this.request(this.wanted!);
      });
    }
  }
  private async drain() {
    do {
      const version = this.wanted!;
      try {
        const file = await this.load();
        if (!this.closed) this.result(file);
      } catch (error) {
        if (!this.closed) this.result(undefined, error);
      }
      this.completed = version;
    } while (!this.closed && this.wanted !== this.completed);
  }
  close() {
    this.closed = true;
  }
}
