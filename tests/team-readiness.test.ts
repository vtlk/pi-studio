import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeamAccess } from '../src/main/pi/runTeamAccess.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';

test('team accepts closed recipients and live idle receivers with previous waiting/error/blocked status', async () => {
  for (const status of [undefined, 'waiting', 'error', 'stopped', 'ready'] as const) {
    const live = status
      ? ({
          pid: process.pid,
          status,
          blocked: true,
          sequence: 4,
          opened: true,
          run: { record: { runId: 'run' } },
          embedded: {
            alive: true,
            state: { phase: 'ready', working: false, queue: { steering: [], followUp: [] } },
          },
        } as LiveRun)
      : undefined;
    const map = new Map<string, LiveRun>(live ? [['p/b', live]] : []);
    let calls = 0;
    const host = runTeamAccess({
      live: map,
      chains: new Map(),
      changing: new Set(),
      opening: new Set(),
      retiring: new Map(),
      assertUnchanged: () => {},
      open: async () => {
        calls++;
        return { runId: 'run', project: { id: 'p' } } as never;
      },
    });
    assert.equal(host.teamUnavailable('p', 'b'), undefined);
    await host.launchTeamTask(
      'p',
      'b',
      'NEW',
      { messageId: 'a'.repeat(64), senderId: 'a', recipientId: 'b', lineage: ['a'] },
      async (_run: PreparedRun) => {},
    );
    assert.equal(calls, 1);
  }
});
test('actual running work, interactive RPC dialogs, queued input and in-flight sends remain busy', () => {
  for (const reason of ['running', 'dialog', 'queued', 'sending'] as const) {
    const live = {
      pid: process.pid,
      status: 'waiting',
      blocked: false,
      sequence: 2,
      opened: true,
      run: { record: { runId: 'run' } },
      embedded: {
        alive: true,
        state: {
          phase: 'ready',
          working: reason === 'running',
          dialog: reason === 'dialog' ? { id: 'question' } : undefined,
          queue: { steering: [], followUp: reason === 'queued' ? ['pending'] : [] },
        },
      },
    } as unknown as LiveRun;
    const host = runTeamAccess({
      live: new Map([['p/b', live]]),
      chains: new Map(),
      changing: new Set(),
      opening: new Set(),
      retiring: new Map(),
      sending: () => reason === 'sending',
      assertUnchanged: () => {},
      open: async () => {
        throw Error('must remain queued');
      },
    });
    assert.ok(host.teamUnavailable('p', 'b'));
  }
});
