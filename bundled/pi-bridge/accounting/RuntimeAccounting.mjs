import { collectUsage } from './usage.mjs';
import { UsageClock } from './Clock.mjs';

export class RuntimeAccounting {
  constructor(session, send) {
    this.session = session;
    this.send = send;
    this.clock = new UsageClock();
    this.offset = 0;
    this.pending = Promise.resolve();
  }
  start() {
    this.clock.start();
  }
  stop() {
    this.clock.stop();
  }
  flush() {
    const task = this.pending.then(async () => {
      const entries = this.session.sessionManager.getEntries();
      if (entries.length < this.offset) this.offset = 0;
      const records = collectUsage(entries.slice(this.offset));
      const snapshot = this.clock.read();
      const key = `${snapshot.elapsedMs}:${snapshot.intervals}:${snapshot.active}`;
      if (!records.length && (!snapshot.intervals || key === this.lastSent)) {
        this.offset = entries.length;
        return;
      }
      for (let i = 0; i < Math.max(1, records.length); i += 200)
        await this.send({
          type: 'accounting',
          usage: { records: records.slice(i, i + 200), time: snapshot },
        });
      this.offset = entries.length;
      this.lastSent = key;
    });
    this.pending = task.catch(() => {});
    return task;
  }
  async close() {
    this.stop();
    await this.flush();
  }
}
