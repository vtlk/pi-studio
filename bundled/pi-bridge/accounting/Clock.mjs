/** One monotonic total per bridge; repeated starts/retries never create overlapping intervals. */
export class UsageClock {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.elapsed = 0;
    this.started = undefined;
    this.intervals = 0;
    this.sample = 0;
  }
  start() {
    if (this.started === undefined) {
      this.started = this.now();
      this.intervals++;
    }
  }
  stop() {
    if (this.started !== undefined) {
      this.elapsed += Math.max(0, this.now() - this.started);
      this.started = undefined;
    }
  }
  read() {
    return {
      sample: ++this.sample,
      elapsedMs: Math.floor(
        this.elapsed + (this.started === undefined ? 0 : Math.max(0, this.now() - this.started)),
      ),
      intervals: this.intervals,
      active: this.started !== undefined,
    };
  }
}
