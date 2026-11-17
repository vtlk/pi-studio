export interface RendererFailure {
  reason: string;
  exitCode?: number;
}
interface RecoveryHost {
  isClosed(): boolean;
  load(): Promise<void>;
  askRetry(): Promise<boolean>;
  close(): void;
  report(failure: RendererFailure): Promise<void>;
  now?: () => number;
}

/** Restores only the failed view; Pi processes and main services remain untouched. */
export class RendererRecovery {
  private readonly host: RecoveryHost;
  private pending?: ReturnType<typeof setImmediate>;
  private busy = false;
  private loading = false;
  private failedWhileLoading = false;
  private disposed = false;
  private automaticUsed = false;
  private lastFailure = -Infinity;
  constructor(host: RecoveryHost) {
    this.host = host;
  }
  failed(failure: RendererFailure) {
    if (this.stopped() || this.pending) return;
    if (this.busy) {
      if (this.loading) this.failedWhileLoading = true;
      return;
    }
    const now = (this.host.now ?? (() => performance.now()))();
    if (now - this.lastFailure >= 60_000) this.automaticUsed = false;
    this.lastFailure = now;
    try {
      void this.host.report(failure).catch(() => {});
    } catch {
      /* Optional diagnostics must not prevent recovery. */
    }
    // A normal window close may finish in the same turn as its renderer exits.
    this.pending = setImmediate(() => {
      this.pending = undefined;
      void this.recover();
    });
  }
  private stopped() {
    return this.disposed || this.host.isClosed();
  }
  private async attemptLoad() {
    this.loading = true;
    this.failedWhileLoading = false;
    try {
      await this.host.load();
      return !this.failedWhileLoading;
    } catch {
      return false;
    } finally {
      this.loading = false;
    }
  }
  private async recover() {
    if (this.stopped()) return;
    this.busy = true;
    try {
      if (!this.automaticUsed) {
        this.automaticUsed = true;
        if (await this.attemptLoad()) return;
      }
      while (!this.stopped()) {
        const retry = await this.host.askRetry();
        if (this.stopped()) return;
        if (!retry) {
          this.host.close();
          return;
        }
        if (await this.attemptLoad()) return;
      }
    } catch {
      // A parent window can disappear while its native recovery dialog is open.
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.disposed = true;
    if (this.pending) clearImmediate(this.pending);
    this.pending = undefined;
  }
}
