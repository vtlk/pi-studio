import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshRuns, type RefreshRunState } from '../src/main/pi/refreshRuns.ts';
import { runKey, type LiveRun } from '../src/main/pi/RunTypes.ts';
import { agentRefreshSignature } from '../src/main/pi/agentRefreshSignature.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

function fixture(working = false) {
  const projectId = 'project',
    stopped: string[] = [],
    restarted: string[] = [];
  const run = (agentId: string, busy: boolean) =>
    ({
      run: {
        record: { runId: agentId, projectId },
        project: { id: projectId },
        agent: { profile: { id: agentId, name: agentId } },
      },
      embedded: { alive: true, state: { working: busy } },
      status: busy ? 'running' : 'waiting',
      sequence: 3,
    }) as LiveRun;
  const live = new Map(
    [
      ['a', run('a', working)],
      ['b', run('b', true)],
    ].map(([id, run]) => [`${projectId}/${id}`, run]),
  ) as Map<string, LiveRun>;
  const state: RefreshRunState = {
    live,
    opening: new Set(),
    retiring: new Map(),
    refreshing: new Set(),
    sending: () => false,
    assertOpen: () => {},
    stop: async (_, id) => {
      stopped.push(id);
    },
    launch: async (_, id) => {
      restarted.push(id);
    },
    changed: () => {},
  };
  const review = { agentId: 'a', agentName: 'a', runId: 'a', sequence: 3, working };
  const result = {
    projects: [
      {
        id: projectId,
        agents: [{ profile: { id: 'a', enabled: true } }, { profile: { id: 'b', enabled: true } }],
      },
    ],
    trashProjects: [],
  } as never;
  return { state, review, result, stopped, restarted };
}
test('scoped refresh locks and restarts only its targets while unrelated running agents remain admitted', async () => {
  const f = fixture();
  await refreshRuns(
    f.state,
    'project',
    ['a'],
    [f.review],
    [],
    { revision: 'r', running: [] },
    async () => {
      assert.equal(f.state.refreshing.has(runKey({ projectId: 'project', agentId: 'a' })), true);
      assert.equal(f.state.refreshing.has(runKey({ projectId: 'project', agentId: 'b' })), false);
      return f.result;
    },
  );
  assert.deepEqual(f.stopped, ['a']);
  assert.deepEqual(f.restarted, ['a']);
  assert.equal(f.state.refreshing.size, 0);
  assert.equal(f.state.live.get('project/b')!.status, 'running');
});
test('active tasks require exact run/sequence consent before any stop or data mutation', async () => {
  for (const running of [[], [{ runId: 'a', sequence: 2 }], [{ runId: 'foreign', sequence: 3 }]]) {
    const f = fixture(true);
    let applied = false;
    await assert.rejects(
      refreshRuns(
        f.state,
        'project',
        ['a'],
        [f.review],
        [],
        { revision: 'r', running },
        async () => {
          applied = true;
          return f.result;
        },
      ),
    );
    assert.deepEqual(f.stopped, []);
    assert.equal(applied, false);
    assert.equal(f.state.refreshing.size, 0);
  }
  const f = fixture(true);
  await refreshRuns(
    f.state,
    'project',
    ['a'],
    [f.review],
    [],
    { revision: 'r', running: [{ runId: 'a', sequence: 3 }] },
    async () => f.result,
  );
  assert.deepEqual(f.stopped, ['a']);
});
test('a new run, new request sequence, opening and closing all invalidate a reviewed process', async () => {
  for (const change of ['run', 'sequence', 'opening', 'retiring']) {
    const f = fixture();
    if (change === 'run') f.state.live.get('project/a')!.run.record.runId = 'replacement';
    if (change === 'sequence') f.state.live.get('project/a')!.sequence++;
    if (change === 'opening') f.state.opening.add('project/a');
    if (change === 'retiring') f.state.retiring.set('project/a', Promise.resolve());
    await assert.rejects(
      refreshRuns(
        f.state,
        'project',
        ['a'],
        [f.review],
        [],
        { revision: 'r', running: [] },
        async () => f.result,
      ),
    );
    assert.deepEqual(f.stopped, []);
  }
});
test('removed and disabled agents close without relaunch; a closed changed agent stays closed', async () => {
  const f = fixture();
  await refreshRuns(
    f.state,
    'project',
    ['a'],
    [],
    [f.review],
    { revision: 'r', running: [] },
    async () => f.result,
  );
  assert.deepEqual(f.stopped, ['a']);
  assert.deepEqual(f.restarted, []);
  const disabled = fixture();
  await refreshRuns(
    disabled.state,
    'project',
    ['a'],
    [disabled.review],
    [],
    { revision: 'r', running: [] },
    async () =>
      ({
        projects: [{ id: 'project', agents: [{ profile: { id: 'a', enabled: false } }] }],
        trashProjects: [],
      }) as never,
  );
  assert.deepEqual(disabled.restarted, []);
  const closed = fixture();
  closed.state.live.delete('project/a');
  await refreshRuns(
    closed.state,
    'project',
    ['a'],
    [],
    [],
    { revision: 'r', running: [] },
    async () => closed.result,
  );
  assert.deepEqual(closed.stopped, []);
  assert.deepEqual(closed.restarted, []);
});
test('restart failure is reported after settings apply, and all locks are released without replaying work', async () => {
  const f = fixture(true);
  f.state.launch = async () => {
    throw Error('Owned startup failure');
  };
  const result = await refreshRuns(
    f.state,
    'project',
    ['a'],
    [f.review],
    [],
    { revision: 'r', running: [{ runId: 'a', sequence: 3 }] },
    async () => f.result,
  );
  assert.deepEqual(result.refreshFailures, [
    { agentId: 'a', name: 'a', message: 'Owned startup failure' },
  ]);
  assert.equal(f.state.refreshing.size, 0);
  const failed = fixture();
  await assert.rejects(
    refreshRuns(
      failed.state,
      'project',
      ['a'],
      [failed.review],
      [],
      { revision: 'r', running: [] },
      async () => {
        throw Error('Save failed');
      },
    ),
    /Save failed/,
  );
  assert.equal(failed.state.refreshing.size, 0);
  assert.deepEqual(failed.restarted, []);
});
test('refresh fingerprints include live prompts and assigned resource config but ignore transient checks and unrelated resources', () => {
  const agent: Agent = {
    id: 'a',
    name: 'A',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: ['mcp'],
    plugins: [],
  };
  const resource = {
    id: 'mcp',
    source: 'https://example.invalid/mcp',
    kind: 'mcps',
    name: 'MCP',
  } as Resource;
  const { instructions: _, ...profile } = agent;
  const original = agentRefreshSignature(profile, agent, [resource]);
  assert.equal(
    agentRefreshSignature(profile, agent, [
      { ...resource, check: { status: 'available', checkedAt: 123 } },
      { ...resource, id: 'unrelated' },
    ]),
    original,
  );
  assert.notEqual(
    agentRefreshSignature(profile, { ...agent, mainInstruction: 'New role' }, [resource]),
    original,
  );
  assert.notEqual(
    agentRefreshSignature(profile, agent, [{ ...resource, source: 'https://other.invalid/mcp' }]),
    original,
  );
});
