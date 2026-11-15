import { UpdateNetworkError } from './githubTransport.ts';

const hour = 3600_000;
interface Clock {
  now(): number;
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const clock: Clock = {
  now: Date.now,
  set: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return timer;
  },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
interface Options<T> {
  check: (signal: AbortSignal) => Promise<T>;
  result: (value: T) => void;
  error: (error: unknown) => void;
  clock?: Clock;
}
/** Startup/hourly/wake share one flight; one delayed retry per failed cycle, never a poll loop. */
export class UpdateSchedule<T> {
  private readonly options: Options<T>;
  private readonly clock: Clock;
  private readonly controller = new AbortController();
  private timer: unknown;
  private flight?: Promise<void>;
  private nextAt = 0;
  private rateLimitedUntil = 0;
  private retry = false;
  private closed = false;
  private started = false;
  constructor(options: Options<T>) {
    this.options = options;
    this.clock = options.clock ?? clock;
  }
  start() {
    if (this.started || this.closed) return;
    this.started = true;
    void this.checkNow();
  }
  wake() {
    if (this.started && !this.closed && this.clock.now() >= this.nextAt) void this.checkNow();
  }
  checkNow(manual = false): Promise<void> {
    if (this.flight) return this.flight;
    const now = this.clock.now();
    if (this.closed || now < this.rateLimitedUntil || (!manual && now < this.nextAt))
      return Promise.resolve();
    this.clock.clear(this.timer);
    if (manual) this.retry = false;
    // Defer the operation so even synchronous throws participate in the same flight.
    const flight = Promise.resolve()
      .then(() => this.options.check(this.controller.signal))
      .then(
        (value) => {
          if (this.closed) return;
          this.retry = false;
          this.nextAt = this.clock.now() + hour;
          this.options.result(value);
        },
        (error: unknown) => {
          if (this.closed) return;
          const retryAt = error instanceof UpdateNetworkError ? error.retryAt : undefined;
          this.rateLimitedUntil = retryAt ?? 0;
          this.nextAt = Math.max(this.clock.now() + (this.retry ? hour : 5 * 60_000), retryAt ?? 0);
          this.retry = !this.retry;
          this.options.error(error);
        },
      )
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
        if (!this.closed && this.started) {
          this.timer = this.clock.set(
            () => {
              void this.checkNow();
            },
            Math.max(1, this.nextAt - this.clock.now()),
          );
        }
      });
    this.flight = flight;
    return flight;
  }
  close() {
    this.closed = true;
    this.clock.clear(this.timer);
    this.controller.abort();
  }
}
