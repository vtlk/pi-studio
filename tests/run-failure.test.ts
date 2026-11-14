import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyProviderFailure } from '../bundled/pi-bridge/provider-failure.mjs';
import { runFailure } from '../src/shared/runFailure.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import { getAgentStatusLabel } from '../src/renderer/features/project/model/agentActivity.ts';
import type { ProjectAgent } from '../src/shared/project.ts';

test('provider errors become narrow safe categories, never raw provider content', () => {
  for (const [message, expected] of [
    ['Codex error: The usage limit has been reached', 'usage_limit'],
    ['insufficient_quota PRIVATE_PROVIDER_DETAIL', 'usage_limit'],
    ['HTTP 429 too many requests', 'rate_limit'],
    ['Rate limit reached', 'rate_limit'],
    ['Context length limit reached', 'provider'],
    ['invalid API key: PRIVATE_PROVIDER_DETAIL', 'authentication'],
    ['fetch failed ECONNRESET', 'network'],
    ['PRIVATE_PROVIDER_DETAIL', 'provider'],
  ])
    assert.equal(classifyProviderFailure(message), expected);
  assert.equal(runFailure('PRIVATE_PROVIDER_DETAIL'), 'provider');
  assert.equal(classifyProviderFailure(null), 'provider');
});

test('quota stops a chain without retries, records a safe code, survives close and clears only on a new explicit request', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  const live = {
    run: { projectRoot: root, record: { runId: 'qa', output } },
    request: { autoContinue: true },
    sequence: 0,
    blocked: false,
    status: 'waiting',
    heartbeat: 0,
    fail: () => {},
  } as LiveRun;
  const changes: (string | undefined)[] = [];
  let handoffs = 0,
    requests = 0;
  const lifecycle = new RunLifecycle({
    bootstraps: '',
    bridge: '',
    prepare: async () => {
      throw new Error('unused');
    },
    read: async () => live.run.project,
    update: async (_run, _status, _session, failure) => {
      if (failure) assert.equal(failure.includes('PRIVATE'), false);
      return live.run.project;
    },
    failureChanged: (_run, failure) => {
      changes.push(failure);
    },
    beforeRequest: async () => {
      requests++;
    },
    completed: async () => {
      handoffs++;
    },
  });
  await lifecycle.event(live, { type: 'request', message: 'Do work' });
  await lifecycle.event(live, {
    type: 'settled',
    outcome: 'error',
    failure: 'usage_limit',
    message: 'PRIVATE_PROVIDER_DETAIL',
  });
  assert.equal(live.status, 'error');
  assert.equal(live.failure, 'usage_limit');
  assert.equal(requests, 1);
  assert.equal(handoffs, 0);
  assert.deepEqual(changes, [undefined, 'usage_limit']);
  const raw = await readFile(join(root, '.pistudio/context/qa/result.json'), 'utf8');
  assert.equal(JSON.parse(raw).failure, 'usage_limit');
  assert.equal(raw.includes('PRIVATE_PROVIDER_DETAIL'), false);
  await lifecycle.event(live, { type: 'stopped' });
  assert.equal(live.failure, 'usage_limit');
  assert.equal(changes.length, 2);
  await lifecycle.event(live, { type: 'request', message: 'An explicit new user input' });
  assert.equal(live.failure, undefined);
  assert.equal(changes.at(-1), undefined);
  assert.equal(requests, 2);
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'waiting');
  assert.equal(handoffs, 0);
  await lifecycle.event(live, { type: 'request', message: 'Validate current output' });
  await writeFile(join(output, 'result.txt'), 'before');
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await writeFile(join(output, 'result.txt'), 'changed');
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.failure, 'outputs');
  assert.equal(handoffs, 0);
});

test('project status distinguishes a provider limit and keeps disabled agents disabled', () => {
  const agent = {
    profile: { enabled: true },
    runStatus: 'error',
    runFailure: 'usage_limit',
  } as ProjectAgent;
  assert.equal(getAgentStatusLabel(agent), 'Лимит подключения');
  assert.equal(
    getAgentStatusLabel({ ...agent, profile: { ...agent.profile, enabled: false } }),
    'Агент выключен',
  );
});

test('a failed handoff preserves the completed stage and reports a safe actionable notice once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-handoff-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  await writeFile(join(output, 'result.txt'), 'Completed previous result');
  const live = {
    run: { projectRoot: root, record: { runId: 'handoff', output } },
    request: { autoContinue: true },
    sequence: 0,
    blocked: false,
    status: 'waiting',
    heartbeat: 0,
  } as LiveRun;
  const notices: (string | undefined)[] = [];
  const statuses: string[] = [];
  let attempts = 0;
  const lifecycle = new RunLifecycle({
    bootstraps: '',
    bridge: '',
    prepare: async () => {
      throw new Error('unused');
    },
    read: async () => live.run.project,
    update: async (_run, status) => {
      statuses.push(status);
      return live.run.project;
    },
    completed: async () => {
      attempts++;
      throw new Error('PRIVATE_PROVIDER_DETAIL: next agent configuration is invalid');
    },
    failureChanged: (_run, failure) => {
      notices.push(failure);
    },
  });
  await lifecycle.event(live, { type: 'request', message: 'Complete and continue' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(live.status, 'ready', 'A next-stage error must not undo the completed stage');
  assert.equal(live.failure, undefined);
  assert.equal(live.blocked, true);
  assert.equal(live.request.autoContinue, false);
  assert.equal(statuses.at(-1), 'ready');
  assert.deepEqual(notices, [undefined, 'continuation']);
  assert.equal(JSON.stringify(notices).includes('PRIVATE'), false);
  const result = JSON.parse(
    await readFile(join(root, '.pistudio/context/handoff/result.json'), 'utf8'),
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.outputs.length, 1);
  assert.equal(await readFile(join(output, 'result.txt'), 'utf8'), 'Completed previous result');
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(attempts, 1);
  assert.deepEqual(notices, [undefined, 'continuation']);
  await lifecycle.event(live, { type: 'request', message: 'An explicit new request' });
  assert.equal(notices.at(-1), undefined);
  assert.equal(live.blocked, false);
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(attempts, 1, 'A new request does not silently rearm a failed chain');
});
