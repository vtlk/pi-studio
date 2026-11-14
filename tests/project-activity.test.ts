import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectActivity } from '../src/main/pi/ProjectActivity.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';

test('project activity counts stable agents separately and ignores retirement of an older run', () => {
  const activity = new ProjectActivity();
  const run = (projectId: string, agentId: string, runId: string) =>
    ({
      project: { id: projectId },
      agent: { profile: { id: agentId } },
      record: { runId },
    }) as LiveRun['run'];
  const first = run('first-project', 'a', 'old'),
    next = run('first-project', 'a', 'new');
  const second = run('first-project', 'b', 'second'),
    other = run('other-project', 'a', 'other');
  activity.set(first, true);
  activity.set(first, true);
  activity.set(second, true);
  activity.set(other, true);
  assert.deepEqual(activity.list(), [
    { projectId: 'first-project', runningAgents: 2 },
    { projectId: 'other-project', runningAgents: 1 },
  ]);
  activity.set(next, true);
  activity.set(first, false);
  assert.equal(activity.list()[0].runningAgents, 2);
  activity.set(next, false);
  assert.equal(activity.list()[0].runningAgents, 1);
  activity.set(second, false);
  assert.deepEqual(activity.list(), [{ projectId: 'other-project', runningAgents: 1 }]);
  activity.set(other, false);
  assert.deepEqual(activity.list(), []);
});

test('project activity starts on runtime start, survives internal agent_end/steering, ends on settle/question/error/loss', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-activity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  const live = {
    run: {
      projectRoot: root,
      project: { id: 'project' },
      agent: { profile: { id: 'agent' } },
      record: { runId: 'run', cwd: root, output },
    },
    request: { autoContinue: false },
    sequence: 0,
    blocked: false,
    status: 'waiting',
    heartbeat: 0,
    fail() {},
  } as unknown as LiveRun;
  const activity = new ProjectActivity();
  const lifecycle = new RunLifecycle({
    bootstraps: '',
    bridge: '',
    prepare: async () => {
      throw Error('unused');
    },
    read: async () => live.run.project,
    update: async () => live.run.project,
    activityChanged: (run, working) => activity.set(run, working),
  });
  await lifecycle.event(live, { type: 'opened' });
  await lifecycle.event(live, { type: 'request', message: 'First request' });
  assert.deepEqual(activity.list(), [], 'Input admission/preparation alone is not runtime work.');
  await lifecycle.event(live, { type: 'running' });
  await lifecycle.event(live, { type: 'running' });
  assert.equal(activity.list()[0].runningAgents, 1);
  await lifecycle.event(live, { type: 'agent_end' });
  await lifecycle.event(live, { type: 'request', message: 'Steering during work' });
  assert.equal(activity.list()[0].runningAgents, 1);
  await lifecycle.tool(live, 'report_blocked', {});
  assert.equal(
    activity.list()[0].runningAgents,
    1,
    'The model can still be composing its question until settled.',
  );
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.deepEqual(activity.list(), []);
  for (const outcome of ['completed', 'aborted', 'error']) {
    await lifecycle.event(live, { type: 'request', message: 'Next request' });
    await lifecycle.event(live, { type: 'running' });
    await lifecycle.event(live, { type: 'settled', outcome });
    assert.deepEqual(activity.list(), []);
  }
  for (const type of ['error', 'stopped']) {
    await lifecycle.event(live, { type: 'running' });
    await lifecycle.event(live, { type });
    assert.deepEqual(activity.list(), []);
  }
  await lifecycle.event(live, { type: 'running' });
  await lifecycle.processLost(live);
  assert.deepEqual(activity.list(), []);
});
