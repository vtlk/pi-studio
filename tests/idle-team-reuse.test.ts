import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseIdleTeam } from '../src/main/pi/reuseIdleTeam.ts';
import { RunChats } from '../src/main/pi/RunChats.ts';
import type { EmbeddedChat } from '../src/main/pi/EmbeddedChat.ts';
import type { LiveRun, RunDependencies } from '../src/main/pi/RunTypes.ts';
import { teamDispatchFailure } from '../src/main/team-mcp/dispatchFailure.ts';
import { t } from '../src/shared/i18n/index.ts';

function fixture() {
  const target = { projectId: 'p', agentId: 'b', autoContinue: false };
  const sent: string[] = [];
  let stops = 0,
    registered = 0;
  const history = [{ id: 'history' }];
  const chat = {
    alive: true,
    state: {
      phase: 'ready',
      working: false,
      messages: history,
      queue: { steering: [], followUp: [] },
    },
    stop: () => stops++,
    send: async (text: string) => {
      sent.push(text);
      live.sequence++;
      live.status = 'running';
      return 'started';
    },
  } as unknown as EmbeddedChat;
  const live = {
    run: {
      project: { id: 'p' },
      projectRoot: '/qa',
      record: { runId: 'existing' },
      agent: { profile: { id: 'b' }, session: { id: 'exact', path: 'exact.jsonl' } },
    },
    embedded: chat,
    status: 'waiting',
    sequence: 0,
    blocked: false,
    request: target,
  } as LiveRun;
  const map = new Map([['p/b', live]]);
  const dependencies = {
    read: async () => live.run.project,
    update: async () => live.run.project,
  } as RunDependencies;
  const state = {
    live: map,
    dependencies,
    chats: new RunChats(
      map,
      dependencies,
      () => {},
      () => {},
    ),
    assertUnchanged: () => {},
    assertTeamDispatch: () => {
      assert.equal(map.get('p/b'), live);
    },
  };
  const delivery = { messageId: 'a'.repeat(64), senderId: 'a', recipientId: 'b', lineage: ['a'] };
  const run = (
    before = async () => {
      registered++;
    },
  ) => reuseIdleTeam(state, target, live, 'TASK', delivery, before);
  return {
    state,
    live,
    chat,
    history,
    delivery,
    run,
    sent,
    stops: () => stops,
    registered: () => registered,
  };
}
test('team task reuses the exact idle process/run/session/history and registers delivery before input', async () => {
  const f = fixture();
  const before = f.live.run.agent.session;
  const result = await f.run();
  assert.equal(result.runId, 'existing');
  assert.deepEqual(f.sent, ['TASK']);
  assert.equal(f.registered(), 1);
  assert.equal(f.live.run.teamDelivery, f.delivery);
  assert.equal(f.live.pendingTeamText, 'TASK');
  assert.equal(f.live.run.agent.session, before);
  assert.equal(f.chat.state.messages, f.history);
  assert.equal(f.stops(), 0);
});
test('working, queued or interactive-dialog recipients never receive input or get stopped', async () => {
  for (const state of ['working', 'queue', 'dialog'] as const) {
    const f = fixture();
    if (state === 'working') f.chat.state.working = true;
    if (state === 'queue') f.chat.state.queue!.followUp = ['pending'];
    if (state === 'dialog')
      f.chat.state.dialog = { id: 'pending' } as NonNullable<typeof f.chat.state.dialog>;
    await assert.rejects(f.run());
    assert.deepEqual(f.sent, []);
    assert.equal(f.registered(), 0);
    assert.equal(f.stops(), 0);
  }
});
test('failed pre-dispatch registration preserves idle dialogue; native handled input rolls back unadmitted metadata', async () => {
  const f = fixture();
  await assert.rejects(
    f.run(async () => {
      throw Error('registration refused');
    }),
    /registration/,
  );
  assert.equal(f.live.run.teamDelivery, undefined);
  assert.deepEqual(f.sent, []);
  assert.equal(f.stops(), 0);
  f.chat.send = async () => 'handled';
  await assert.rejects(f.run());
  assert.equal(f.live.run.teamDelivery, undefined);
  assert.equal(f.live.pendingTeamText, undefined);
  assert.equal(f.live.automaticCheck, undefined);
  assert.equal(f.stops(), 0);
});
test('team preparation failure reports only known static app diagnostics, never raw provider secrets', () => {
  const known = teamDispatchFailure(Error(t('error.runHost.thisDialogueIsStillOpen')));
  assert.ok(known.includes(t('error.runHost.thisDialogueIsStillOpen')));
  assert.ok(
    !teamDispatchFailure(Error('Bearer PRIVATE_SECRET https://private/?key=SECRET')).includes(
      'SECRET',
    ),
  );
});

test('native preflight failure after the input hook does not leave an idle recipient marked running', async () => {
  const f = fixture();
  f.chat.send = async () => {
    f.live.sequence++;
    f.live.status = 'running';
    throw Error('preflight refused');
  };
  await assert.rejects(f.run(), /preflight/);
  assert.equal(f.live.status, 'waiting');
  assert.equal(f.live.automaticCheck, undefined);
  assert.equal(f.stops(), 0);
  assert.equal(f.chat.state.messages, f.history);
});

test('a fresh explicit team task starts in an idle dialogue after previous waiting, blocked or error status', async () => {
  for (const status of ['waiting', 'error', 'stopped', 'ready'] as const) {
    const f = fixture();
    f.live.status = status;
    f.live.sequence = 3;
    f.live.blocked = true;
    await f.run();
    assert.deepEqual(f.sent, ['TASK']);
    assert.equal(f.registered(), 1);
    assert.equal(f.stops(), 0);
  }
});
