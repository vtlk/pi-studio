import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-request-completion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  await writeFile(join(output, 'result.txt'), 'Completed first request');
  const live = {
    run: { projectRoot: root, record: { runId: 'request-completion', output } },
    request: { autoContinue: true },
    sequence: 0,
    status: 'waiting',
    blocked: false,
    heartbeat: 0,
  } as LiveRun;
  let handoffs = 0;
  const lifecycle = new RunLifecycle({
    bootstraps: '',
    bridge: '',
    prepare: async () => {
      throw Error('unused');
    },
    read: async () => live.run.project,
    update: async () => live.run.project,
    completed: async () => {
      handoffs++;
    },
  });
  return { live, lifecycle, handoffs: () => handoffs };
}

test('a previous request completion still hashing files cannot complete or advance a newer request', async (t) => {
  const { live, lifecycle, handoffs } = await fixture(t);
  await lifecycle.event(live, { type: 'request', message: 'First request' });
  // The real filesystem validation is pending while the separately admitted input advances.
  const previous = lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'request', message: 'New user request' });
  await assert.rejects(previous, /Сигнал завершения относится к завершённому или другому запросу/);
  assert.equal(live.sequence, 2);
  assert.equal(live.completion, undefined);
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'waiting');
  assert.equal(handoffs(), 0);
  // Its own explicit completion remains valid and advances once.
  await lifecycle.event(live, { type: 'request', message: 'Complete current result' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'ready');
  assert.equal(handoffs(), 1);
});

test('abort discards in-flight completion and an idle duplicate cannot replace the settled result', async (t) => {
  const { live, lifecycle, handoffs } = await fixture(t);
  await lifecycle.event(live, { type: 'request', message: 'Work then abort' });
  const previous = lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await Promise.all([
    assert.rejects(previous, /Сигнал завершения относится/),
    lifecycle.event(live, { type: 'settled', outcome: 'aborted' }),
  ]);
  assert.equal(live.completion, undefined);
  assert.equal(live.status, 'stopped');
  assert.equal(handoffs(), 0);
  await assert.rejects(
    lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] }),
    /Сигнал завершения относится/,
  );
});

test('a delayed settled validation cannot mark the next admitted request ready or hand it off', async (t) => {
  const { live, lifecycle, handoffs } = await fixture(t);
  await lifecycle.event(live, { type: 'request', message: 'Complete first' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  const settled = lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  await lifecycle.event(live, { type: 'request', message: 'Second request still working' });
  await settled;
  assert.equal(live.sequence, 2);
  assert.equal(live.status, 'running');
  assert.equal(live.completion, undefined);
  assert.equal(handoffs(), 0);
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'waiting');
  assert.equal(handoffs(), 0);
});
