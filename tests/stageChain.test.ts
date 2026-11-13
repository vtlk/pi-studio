import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextEnabledStage } from '../src/main/pi/stageChain.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { LiveRun, RunDependencies } from '../src/main/pi/RunTypes.ts';
import type { WorkspaceProject } from '../src/shared/project.ts';

test('the stage chain follows explicit snapshot order and skips disabled stages without fallback', () => {
  const project = {
    agents: [
      { profile: { id: 'a', enabled: true } },
      { profile: { id: 'disabled', enabled: false } },
      { profile: { id: 'c', enabled: true } },
    ],
  } as WorkspaceProject;
  assert.equal(nextEnabledStage(project, 'a')?.profile.id, 'c');
  assert.equal(nextEnabledStage(project, 'c'), undefined);
  assert.throws(() => nextEnabledStage(project, 'deleted'));
});
test('only a new request plus explicit validated completion continues once; questions/errors/changed outputs pause', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-chain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = {
    record: { runId: 'one', output: root },
    projectRoot: root,
    project: { id: 'project' },
    agent: { profile: { id: 'a' } },
  } as PreparedRun;
  let calls = 0;
  const dependencies = {
    update: async () => ({}) as WorkspaceProject,
    completed: async () => {
      calls++;
    },
  } as unknown as RunDependencies;
  const lifecycle = new RunLifecycle(dependencies);
  const live: LiveRun = {
    run,
    request: { projectId: 'project', agentId: 'a', autoContinue: true },
    status: 'waiting',
    sequence: 0,
    blocked: false,
    heartbeat: Date.now(),
    ready: () => {},
    fail: () => {},
  };
  await writeFile(join(root, 'result.txt'), 'first');
  await assert.rejects(
    lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] }),
    /нового запроса/,
  );
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(calls, 0);
  assert.equal(live.status, 'waiting');
  await lifecycle.event(live, { type: 'request', message: 'A new task' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(calls, 1);
  assert.equal(live.status, 'ready');
  await lifecycle.event(live, { type: 'request', message: 'A question' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.tool(live, 'report_blocked', {});
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(calls, 1);
  assert.equal(live.status, 'waiting');
  await lifecycle.event(live, { type: 'request', message: 'Changed outputs' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await writeFile(join(root, 'result.txt'), 'changed after signal');
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(calls, 1);
  assert.equal(live.status, 'error');
  await lifecycle.event(live, { type: 'request', message: 'Request failed' });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'error' });
  assert.equal(calls, 1);
  assert.equal(live.status, 'error');
});
