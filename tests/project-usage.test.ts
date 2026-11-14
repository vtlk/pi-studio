import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { UsageLedger } from '../src/main/accounting/UsageLedger.ts';
import { collectUsage } from '../bundled/pi-bridge/accounting/usage.mjs';
import { UsageClock } from '../bundled/pi-bridge/accounting/Clock.mjs';
import { parseUsageSample } from '../src/main/accounting/usageState.ts';
import type { UsageRecord } from '../src/shared/projectUsage.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { deleteAgentData } from '../src/main/storage/deleteAgentData.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';

const record = (
  id: string,
  input = 100,
  output = 20,
  cost: UsageRecord['cost'] = { value: 0.004, currency: 'USD', estimated: true },
): UsageRecord => ({
  id: id.repeat(32),
  tokens: { input, output, cacheRead: 50, cacheWrite: 3, total: input + output + 53 },
  ...(cost ? { cost } : {}),
});
async function fixture(t: import('node:test').TestContext, fresh = true) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-usage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = new UsageLedger(root, 'project');
  await ledger.load(['a', 'b'], fresh);
  await ledger.flush();
  return { root, ledger };
}
test('accounting keeps separate input/output/cache, deduplicates resumed history and preserves incurred spend after resets', async (t) => {
  const { root, ledger } = await fixture(t);
  assert.deepEqual(ledger.summary().total.tokens.input, { value: 0, partial: false });
  assert.equal(ledger.summary().total.costs[0].value, 0);
  await ledger.begin('a', 'first-run');
  await ledger.apply('a', 'first-run', {
    records: [record('a')],
    time: { sample: 1, elapsedMs: 1000, intervals: 1, active: false },
  });
  const reopened = new UsageLedger(root, 'project');
  await reopened.load(['a', 'b']);
  await reopened.begin('a', 'resume');
  await reopened.apply('a', 'resume', {
    records: [record('a'), record('b', 7, 3)],
    time: { sample: 1, elapsedMs: 500, intervals: 1, active: false },
  });
  const total = reopened.summary().total;
  assert.equal(total.tokens.input.value, 107);
  assert.equal(total.tokens.output.value, 23);
  assert.equal(total.tokens.cacheRead.value, 100);
  assert.equal(total.tokens.total.value, 236);
  assert.equal(total.duration.value, 1500);
  assert.equal(total.costs[0].value, 0.008);
  // A dialogue reset does not reset the sidecar or re-add its old native entry IDs.
  await reopened.begin('a', 'after-reset');
  await reopened.apply('a', 'after-reset', { records: [record('a'), record('c', 2, 1)] });
  assert.equal(reopened.summary().total.tokens.input.value, 109);
  const text = await readFile(join(root, '.pistudio/usage.json'), 'utf8');
  assert.doesNotMatch(text, /prompt|instructions|transcript|credential/);
});

test('parallel accounting commits do not lose another agent and late clock samples cannot charge twice', async (t) => {
  const { ledger } = await fixture(t);
  await ledger.begin('a', 'run-a');
  await ledger.begin('b', 'run-b');
  await Promise.all([
    ledger.apply('a', 'run-a', {
      records: [record('a')],
      time: { sample: 1, elapsedMs: 300000, intervals: 1, active: true },
    }),
    ledger.apply('b', 'run-b', {
      records: [record('b')],
      time: { sample: 1, elapsedMs: 300000, intervals: 1, active: true },
    }),
  ]);
  assert.equal(ledger.summary().total.duration.value, 600000);
  assert.equal(ledger.summary().total.tokens.input.value, 200);
  await ledger.apply('a', 'run-a', {
    records: [record('a')],
    time: { sample: 1, elapsedMs: 300000, intervals: 1, active: true },
  });
  await ledger.begin('a', 'new-a');
  await ledger.apply('a', 'run-a', {
    records: [],
    time: { sample: 99, elapsedMs: 900000, intervals: 2, active: false },
  });
  assert.equal(ledger.summary().total.duration.value, 600000);
});

test('crash/restart keeps only confirmed time and marks its unknown tail, without charging idle wall time', async (t) => {
  const { root, ledger } = await fixture(t);
  await ledger.begin('a', 'before-crash');
  await ledger.apply('a', 'before-crash', {
    records: [],
    time: { sample: 1, elapsedMs: 1500, intervals: 1, active: true },
  });
  const restarted = new UsageLedger(root, 'project');
  await restarted.load(['a', 'b']);
  assert.deepEqual(restarted.summary().total.duration, { value: 1500, partial: true });
  await restarted.begin('a', 'after-crash');
  await restarted.apply('a', 'after-crash', {
    records: [],
    time: { sample: 1, elapsedMs: 500, intervals: 1, active: false },
  });
  assert.deepEqual(restarted.summary().total.duration, { value: 2000, partial: true });
});

test('a crash immediately after runtime start marks unknown time even before the first periodic sample', async (t) => {
  const { ledger } = await fixture(t);
  await ledger.begin('a', 'early-crash');
  await ledger.apply('a', 'early-crash', {
    records: [],
    time: { sample: 1, elapsedMs: 0, intervals: 1, active: true },
  });
  await ledger.lost('a', 'early-crash');
  assert.deepEqual(ledger.summary().agents.a.duration, { value: 0, partial: true });
  assert.deepEqual(ledger.summary().agents.b.duration, { value: 0, partial: false });
});

test('clone and rename keep historical totals/cursors but future clone spend is independent', async (t) => {
  const { root, ledger } = await fixture(t);
  await ledger.begin('a', 'original');
  await ledger.apply('a', 'original', {
    records: [record('a')],
    time: { sample: 1, elapsedMs: 2000, intervals: 1, active: false },
  });
  const cloneRoot = join(root, 'clone');
  await mkdir(join(cloneRoot, '.pistudio'), { recursive: true });
  await copyFile(join(root, '.pistudio/usage.json'), join(cloneRoot, '.pistudio/usage.json'));
  const clone = new UsageLedger(cloneRoot, 'clone');
  await clone.load(['a', 'b']);
  await clone.relocate(cloneRoot, 'clone');
  assert.equal(clone.summary().total.duration.value, 2000);
  await clone.begin('a', 'clone-run');
  await clone.apply('a', 'clone-run', { records: [record('a'), record('b', 4, 2)] });
  assert.equal(clone.summary().total.tokens.input.value, 104);
  assert.equal(ledger.summary().total.tokens.input.value, 100);
  assert.equal(clone.summary().projectId, 'clone');
});

test('unknown tokens/technical subscription zero are not free usage; currency totals remain separate', async (t) => {
  const { ledger } = await fixture(t);
  await ledger.apply('a', undefined, { records: [{ id: 'a'.repeat(32), tokens: { output: 20 } }] });
  assert.deepEqual(ledger.summary().total.tokens.input, { value: null, partial: true });
  assert.equal(ledger.summary().total.tokens.output.value, 20);
  assert.deepEqual(ledger.summary().total.costs, []);
  assert.equal(ledger.summary().total.costPartial, true);
  await ledger.apply('a', undefined, {
    records: [
      record('b', 1, 1, { value: 0, currency: 'USD', estimated: false }),
      record('c', 1, 1, { value: 0.006, currency: 'EUR', estimated: true }),
    ],
  });
  assert.deepEqual(
    ledger.summary().total.costs.map((money) => [money.currency, money.value]),
    [
      ['USD', 0],
      ['EUR', 0.006],
    ],
  );
  assert.equal(ledger.summary().total.costPartial, true);
});

test('native usage extraction includes compaction, branch, tools and auxiliary usage without duplicate totals', () => {
  const usage = {
    input: 10,
    output: 3,
    cacheRead: 7,
    cacheWrite: 2,
    totalTokens: 22,
    cost: { total: 0.00002 },
  };
  const entry = (type, id, extra) => ({ type, id, timestamp: '2026-11-15T00:00:00Z', ...extra });
  const entries = [
    entry('message', 'a', { message: { role: 'assistant', usage } }),
    entry('compaction', 'b', { usage }),
    entry('branch_summary', 'c', { usage }),
    entry('message', 'd', { message: { role: 'toolResult', usage } }),
    entry('usage', 'e', { usage }),
  ];
  const rows = collectUsage(entries);
  assert.equal(rows.length, 5);
  assert.equal(
    rows.reduce((sum, item) => sum + item.tokens.total, 0),
    110,
  );
  const unpriced = collectUsage([
    entry('message', 'f', {
      message: { role: 'assistant', usage: { ...usage, cost: { total: 0 } } },
    }),
  ]);
  assert.equal(unpriced[0].cost, undefined);
  const free = collectUsage([
    entry('usage', 'g', { usage: { ...usage, cost: { total: 0, totalFromProvider: true } } }),
  ]);
  assert.equal(free[0].cost.value, 0);
  assert.equal(
    collectUsage(entries.map((item) => ({ ...item })))[0].id,
    rows[0].id,
    'Native fork retains entry identity.',
  );
});

test('monotonic usage clock excludes idle and repeated starts/retries do not overlap intervals', () => {
  let now = 1000;
  const clock = new UsageClock(() => now);
  assert.equal(clock.read().elapsedMs, 0);
  clock.start();
  now += 500;
  clock.start();
  assert.equal(clock.read().elapsedMs, 500);
  now += 500;
  clock.stop();
  now += 86400000;
  assert.equal(clock.read().elapsedMs, 1000);
  clock.start();
  now += 200;
  clock.stop();
  const sample = clock.read();
  assert.equal(sample.elapsedMs, 1200);
  assert.equal(sample.intervals, 2);
  assert.equal(sample.active, false);
});

test(
  'malformed/special ledger files are preserved and unknown, and overflow cannot partially commit spend',
  { timeout: 1500 },
  async (t) => {
    const { root, ledger } = await fixture(t);
    const path = join(root, '.pistudio/usage.json');
    const before = await readFile(path, 'utf8');
    await assert.rejects(
      ledger.apply('a', undefined, {
        records: [record('a', Number.MAX_SAFE_INTEGER, 0), record('b', 1, 0)],
      }),
    );
    assert.equal(await readFile(path, 'utf8'), before);
    await writeFile(path, '{bad');
    const bad = new UsageLedger(root, 'project');
    await bad.load(['a']);
    assert.equal(bad.failed, true);
    await assert.rejects(bad.begin('a', 'run'));
    assert.equal(await readFile(path, 'utf8'), '{bad');
    await rm(path);
    execFileSync('/usr/bin/mkfifo', [path]);
    const pipe = new UsageLedger(root, 'project');
    await pipe.load(['a']);
    assert.equal(pipe.failed, true);
    assert.equal(pipe.summary().total.tokens.input.value, null);
    assert.throws(() => parseUsageSample({ records: [], time: { sample: -1 } }));
  },
);

test('actual project CRUD, archive/undo, dialogue reset and reopening preserve incurred metrics independently', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-usage-crud-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = await StudioStore.open(root);
  const profiles = ['a', 'b'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  }));
  const created = await store.command({ kind: 'create', name: 'Original', agents: profiles });
  const project = created.projects.find((item) => item.id === created.selectedId)!;
  const directory = await store.projects.directory(project.id);
  const run = {
    project,
    agent: project.agents[0],
    projectRoot: directory,
    record: { runId: 'first' },
  } as PreparedRun;
  await store.accounting.begin(run);
  await store.accounting.record(run, {
    records: [record('a')],
    time: { sample: 1, elapsedMs: 1250, intervals: 1, active: false },
  });
  const expected = store.accounting.summary(project.id)!.total;
  const other = await store.command({ kind: 'create', name: 'Unrelated', agents: profiles });
  assert.equal(store.accounting.summary(other.selectedId!)!.total.tokens.input.value, 0);
  await writeFile(join(directory, 'agents/a/sessions/history.jsonl'), 'Fixture canonical dialogue');
  await store.projects.updateRuntime(project.id, 'a', 'waiting', {
    id: 'history',
    title: 'A',
    path: 'agents/a/sessions/history.jsonl',
    createdAt: 1,
  });
  await deleteAgentData(
    store,
    { folder: store.folder, projectId: project.id, agentId: 'a', target: 'all' },
    (path) => rm(path, { recursive: true }),
  );
  assert.deepEqual(store.accounting.summary(project.id)!.total, expected);
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'a' });
  assert.deepEqual(
    store.accounting.summary(project.id)!.total,
    expected,
    'Archived agent remains in the sum.',
  );
  await store.command({ kind: 'restore-agent', projectId: project.id, agentId: 'a' });
  assert.deepEqual(
    store.accounting.summary(project.id)!.total,
    expected,
    'Undo never doubles the aggregate.',
  );
  await store.command({ kind: 'rename', projectId: project.id, name: 'Новое имя' });
  await assert.rejects(
    store.accounting.record(run, { records: [record('b')] }),
    /папка изменилась/,
  );
  await store.command({ kind: 'remove', projectId: project.id });
  await store.command({ kind: 'restore', projectId: project.id });
  const clone = await store.command({ kind: 'clone', projectId: project.id, name: 'Clone' });
  assert.deepEqual(store.accounting.summary(clone.selectedId!)!.total, expected);
  await store.accounting.recover(clone.selectedId!, 'a', [record('a'), record('b', 5, 2)]);
  assert.equal(store.accounting.summary(clone.selectedId!)!.total.tokens.input.value, 105);
  assert.deepEqual(store.accounting.summary(project.id)!.total, expected);
  store = await StudioStore.open(root);
  assert.deepEqual(store.accounting.summary(project.id)!.total, expected);
  assert.equal(store.accounting.summary(clone.selectedId!)!.total.tokens.input.value, 105);
  assert.equal(
    store.bootstrap().projects.find((item) => item.id === project.id)!.agents[0].usage!.duration
      .value,
    1250,
  );
});
