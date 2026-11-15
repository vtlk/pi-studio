import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateSchedule } from '../src/main/updates/UpdateSchedule.ts';
import { UpdateNetworkError } from '../src/main/updates/githubTransport.ts';

class Clock {
  time = 1000;
  id = 0;
  timers = new Map<number, { callback: () => void; at: number }>();
  now = () => this.time;
  set = (callback: () => void, milliseconds: number) => {
    const id = ++this.id;
    this.timers.set(id, { callback, at: this.time + milliseconds });
    return id;
  };
  clear = (id: unknown) => {
    this.timers.delete(Number(id));
  };
  jump(milliseconds: number) {
    this.time += milliseconds;
  }
  fireDue() {
    const due = [...this.timers].filter(([, timer]) => timer.at <= this.time);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('startup/hourly/wake coalesce into one flight and sleep never creates a queue of missed checks', async () => {
  const clock = new Clock();
  let checks = 0,
    results = 0,
    release: (() => void) | undefined;
  const schedule = new UpdateSchedule({
    clock,
    check: async () => {
      checks++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return checks;
    },
    result: () => {
      results++;
    },
    error: (error) => {
      throw error;
    },
  });
  schedule.start();
  schedule.start();
  schedule.wake();
  await settle();
  assert.equal(checks, 1);
  const flight = schedule.checkNow(true);
  clock.jump(4 * 3600_000);
  schedule.wake();
  clock.fireDue();
  assert.equal(checks, 1);
  release!();
  await flight;
  assert.equal(results, 1);
  schedule.wake();
  await settle();
  assert.equal(checks, 1);
  clock.jump(3600_000);
  schedule.wake();
  clock.fireDue();
  await settle();
  assert.equal(checks, 2);
  const second = schedule.checkNow();
  release!();
  await second;
  schedule.close();
  clock.jump(3 * 3600_000);
  schedule.wake();
  clock.fireDue();
  await settle();
  assert.equal(checks, 2);
  assert.equal(clock.timers.size, 0);
});

test('offline retry is bounded; Retry-After blocks manual/wake storms and close aborts without late results', async () => {
  const clock = new Clock();
  let checks = 0,
    errors = 0;
  const schedule = new UpdateSchedule({
    clock,
    check: async () => {
      checks++;
      throw new Error('offline');
    },
    result: () => assert.fail(),
    error: () => {
      errors++;
    },
  });
  schedule.start();
  await settle();
  assert.equal(checks, 1);
  for (let i = 0; i < 10; i++) schedule.wake();
  await settle();
  assert.equal(checks, 1);
  clock.jump(5 * 60_000);
  clock.fireDue();
  await settle();
  assert.equal(checks, 2);
  clock.jump(5 * 60_000);
  clock.fireDue();
  schedule.wake();
  await settle();
  assert.equal(checks, 2);
  clock.jump(55 * 60_000);
  clock.fireDue();
  await settle();
  assert.equal(checks, 3);
  assert.equal(errors, 3);
  schedule.close();
  let rateChecks = 0;
  const rate = new UpdateSchedule({
    clock,
    check: async () => {
      rateChecks++;
      throw new UpdateNetworkError('limited', clock.now() + 2 * 3600_000);
    },
    result: () => assert.fail(),
    error: () => undefined,
  });
  rate.start();
  await settle();
  clock.jump(3600_000);
  await rate.checkNow(true);
  rate.wake();
  clock.fireDue();
  await settle();
  assert.equal(rateChecks, 1);
  clock.jump(3600_000);
  rate.wake();
  await settle();
  assert.equal(rateChecks, 2);
  rate.close();
  let resolve: (() => void) | undefined,
    aborted = false;
  const closing = new UpdateSchedule({
    clock,
    check: async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      await new Promise<void>((done) => {
        resolve = done;
      });
      return 1;
    },
    result: () => assert.fail('late result'),
    error: () => assert.fail('late error'),
  });
  closing.start();
  await settle();
  closing.close();
  resolve!();
  await settle();
  assert.equal(aborted, true);
  assert.equal(clock.timers.size, 0);
});
