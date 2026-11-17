import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  GitHubStarReminder,
  type ReminderClock,
} from '../src/main/github-star/GitHubStarReminder.ts';
import { githubStarInterval as interval, isGitHubStarState } from '../src/shared/githubStar.ts';

class Clock implements ReminderClock {
  time = 0;
  id = 0;
  jobs = new Map<number, { at: number; run: () => void }>();
  now() {
    return this.time;
  }
  set(run: () => void, ms: number) {
    const id = ++this.id;
    this.jobs.set(id, { at: this.time + ms, run });
    return id;
  }
  clear(id: unknown) {
    this.jobs.delete(id as number);
  }
  async advance(ms: number) {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.time = next[1].at;
      this.jobs.delete(next[0]);
      next[1].run();
      await new Promise<void>((done) => setImmediate(done));
    }
    this.time = target;
  }
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-star-'));
  const clock = new Clock();
  const file = join(root, 'github-star.json');
  const writes: unknown[] = [];
  const reminder = await GitHubStarReminder.load(file, {
    clock,
    persist: async (_file, value) => {
      writes.push(structuredClone(value));
    },
  });
  t.after(async () => {
    await reminder.close();
    await rm(root, { recursive: true, force: true });
  });
  return { reminder, clock, file, writes };
}
test('threshold, periodic persistence and repeated Later use accumulated monotonic app time', async (t) => {
  const { reminder, clock, writes } = await fixture(t);
  const transitions: boolean[] = [];
  reminder.subscribe((state) => transitions.push(state.due));
  await clock.advance(interval - 1);
  assert.equal(reminder.read().due, false);
  assert.ok(writes.length >= 179);
  await clock.advance(1);
  assert.equal(reminder.read().due, true);
  assert.equal(clock.jobs.size, 0);
  await clock.advance(interval * 5); // No queue of missed periods.
  assert.deepEqual(transitions, [true]);
  let opened = 0;
  for (let i = 0; i < 2; i++) {
    await reminder.choose('later', async () => {
      opened++;
    });
    assert.equal(reminder.read().due, false);
    await clock.advance(interval - 1);
    assert.equal(reminder.read().due, false);
    await clock.advance(1);
    assert.equal(reminder.read().due, true);
  }
  assert.equal(opened, 0);
});
test('computer sleep and wall-clock changes add no running time', async (t) => {
  const { reminder, clock } = await fixture(t);
  await clock.advance(interval / 3);
  await reminder.suspend();
  await clock.advance(interval * 20);
  assert.equal(reminder.read().due, false);
  reminder.resume();
  const original = Date.now;
  t.after(async () => {
    Date.now = original;
  });
  Date.now = () => original() + interval * 100;
  await clock.advance((interval * 2) / 3 - 1);
  assert.equal(reminder.read().due, false);
  await clock.advance(1);
  assert.equal(reminder.read().due, true);
});
test('2h then normal quit then 1h after restart retains accumulated time outside studios', async (t) => {
  const { reminder, clock, file, writes } = await fixture(t);
  await clock.advance((interval * 2) / 3);
  await reminder.close();
  await writeFile(file, JSON.stringify(writes.at(-1)));
  const newClock = new Clock();
  newClock.time = interval * 100; // Process downtime does not count.
  const next = await GitHubStarReminder.load(file, { clock: newClock, persist: async () => {} });
  t.after(() => next.close());
  await newClock.advance(interval / 3 - 1);
  assert.equal(next.read().due, false);
  await newClock.advance(1);
  assert.equal(next.read().due, true);
});
test('Open persists opt-out before opener, failure and duplicate clicks never re-enable it', async (t) => {
  const { reminder, clock, file, writes } = await fixture(t);
  await clock.advance(interval);
  let opened = 0;
  const open = async () => {
    opened++;
    assert.deepEqual(writes.at(-1), { schema: 1, elapsedMs: 0, disabled: true });
    throw Error('Browser unavailable');
  };
  await Promise.all([reminder.choose('open', open), reminder.choose('open', open)]);
  assert.equal(opened, 1);
  assert.equal(reminder.read().disabled, true);
  assert.equal(reminder.read().error, 'open');
  await clock.advance(interval * 20);
  assert.equal(reminder.read().due, false);
  assert.equal(clock.jobs.size, 0);
  await reminder.close();
  await writeFile(file, JSON.stringify(writes.at(-1)));
  const next = await GitHubStarReminder.load(file, { clock, persist: async () => {} });
  t.after(() => next.close());
  await clock.advance(interval * 20);
  assert.equal(next.read().disabled, true);
  assert.equal(next.read().due, false);
  assert.equal(clock.jobs.size, 0);
});
test('corrupt preferences fail closed and are not overwritten', async (t) => {
  const { file, clock } = await fixture(t);
  await writeFile(file, 'not JSON');
  const reminder = await GitHubStarReminder.load(file, { clock });
  assert.equal(reminder.read().disabled, true);
  assert.equal(reminder.read().error, 'read');
  await reminder.close();
  assert.equal(await readFile(file, 'utf8'), 'not JSON');
});
test('failed opt-out write never opens browser; normal close retries without re-enabling', async (t) => {
  const { file, clock } = await fixture(t);
  let fail = true,
    opened = 0;
  const reminder = await GitHubStarReminder.load(file, {
    clock,
    persist: async (_file, value) => {
      if (fail) throw Error('disk full');
      await writeFile(file, JSON.stringify(value));
    },
  });
  await clock.advance(interval);
  await reminder.choose('open', async () => {
    opened++;
  });
  assert.equal(opened, 0);
  assert.equal(reminder.read().error, 'write');
  assert.equal(reminder.read().disabled, true);
  fail = false;
  await reminder.close();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).disabled, true);
});
test('real atomic storage survives process-style reopen and validates IPC state', async (t) => {
  const { clock, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ schema: 1, elapsedMs: interval, disabled: false }));
  const reminder = await GitHubStarReminder.load(file, { clock });
  await reminder.choose('later', async () => assert.fail('Later opened browser'));
  await reminder.close();
  const next = await GitHubStarReminder.load(file, { clock });
  t.after(() => next.close());
  assert.equal(next.read().due, false);
  assert.equal(isGitHubStarState({ ...next.read(), canPresent: true }), true);
  assert.equal(isGitHubStarState({ ...next.read(), canPresent: 'true' }), false);
  await assert.rejects(
    next.choose('https://example.com', async () => {}),
    /Unknown/,
  );
});
