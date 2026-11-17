import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseIdleChain } from '../src/main/pi/reuseIdleChain.ts';
import { RunChats } from '../src/main/pi/RunChats.ts';
import {
  ContinuationCancelled,
  type LiveRun,
  type RunDependencies,
} from '../src/main/pi/RunTypes.ts';
import type { EmbeddedChat } from '../src/main/pi/EmbeddedChat.ts';
import type { ChatState } from '../src/shared/chat.ts';
import { i18n } from '../src/shared/i18n/index.ts';

function fixture() {
  const target = { projectId: 'p', agentId: 'next' };
  const history = [
    { id: 'old-message', role: 'user', parts: [{ type: 'text', text: 'KEEP_HISTORY' }] },
  ];
  const state = {
    phase: 'ready',
    working: false,
    queue: { steering: [], followUp: [] },
    messages: history,
  } as unknown as ChatState;
  const sent: string[] = [];
  let stops = 0;
  const chat = {
    alive: true,
    state,
    child: { pid: 12345 },
    stop: () => stops++,
    send: async (message: string) => {
      sent.push(message);
      live.automaticCheck?.();
      live.sequence++;
      live.status = 'running';
      state.working = true;
      live.automaticCheck = undefined;
      live.preserveProcessOnAdmissionCancel = undefined;
      return 'started';
    },
  } as unknown as EmbeddedChat;
  const live = {
    run: {
      record: { runId: 'old-run', projectId: 'p', agentId: 'next' },
      project: { id: 'p' },
      projectRoot: '/qa',
      agent: { profile: { id: 'next' }, session: { id: 'old-session', path: 'old.jsonl' } },
    },
    request: { ...target, autoContinue: false },
    embedded: chat,
    status: 'waiting',
    sequence: 2,
    blocked: false,
    heartbeat: Date.now(),
    pid: 12345,
  } as LiveRun;
  const map = new Map([['p/next', live]]);
  const dependencies = {
    embedded: true,
    read: async () => live.run.project,
    update: async () => live.run.project,
  } as RunDependencies;
  const chats = new RunChats(
    map,
    dependencies,
    () => {},
    () => {},
  );
  const opening = { live: map, chats, dependencies, assertUnchanged: () => {} };
  let cancelled = false;
  const continuation = {
    token: Symbol('chain'),
    check: () => {
      if (cancelled) throw new ContinuationCancelled();
    },
  };
  const run = () =>
    reuseIdleChain(opening, { ...target, autoContinue: true }, live, 'CHAIN_TASK', continuation);
  return {
    target,
    live,
    state,
    sent,
    chat,
    chats,
    run,
    history,
    stops: () => stops,
    cancel: () => {
      cancelled = true;
    },
  };
}
test('chain handoff uses the exact idle chat/run/session and sends once without a queue behavior', async () => {
  const f = fixture(),
    run = f.live.run,
    session = run.agent.session;
  const result = await f.run();
  assert.equal(result.runId, 'old-run');
  assert.equal(f.live.run, run);
  assert.equal(f.live.run.agent.session, session);
  assert.equal(f.chat.state.messages, f.history);
  assert.equal(f.live.pid, 12345);
  assert.deepEqual(f.sent, ['CHAIN_TASK']);
  assert.equal(f.stops(), 0);
  assert.equal(f.live.request.autoContinue, true);
  assert.equal(f.live.continueAfterSequence, 3);
  assert.equal(f.live.sequence, 3);
});
test('busy, native queued and extension-input recipients are left untouched', async () => {
  for (const busy of ['status', 'native', 'steer', 'followUp', 'dialog']) {
    const f = fixture();
    if (busy === 'status') f.live.status = 'running';
    if (busy === 'native') f.state.working = true;
    if (busy === 'steer') f.state.queue!.steering = ['pending'];
    if (busy === 'followUp') f.state.queue!.followUp = ['pending'];
    if (busy === 'dialog') f.state.dialog = { id: 'input', method: 'input' } as ChatState['dialog'];
    const old = f.live.request;
    await assert.rejects(f.run());
    assert.deepEqual(f.sent, []);
    assert.equal(f.live.request, old);
    assert.equal(f.chat.state.messages, f.history);
    assert.equal(f.stops(), 0);
  }
});
test('a manual send in flight blocks handoff; an admitted automatic send excludes manual input', async () => {
  for (const automatic of [false, true]) {
    const f = fixture();
    let release!: (value: string) => void;
    f.chat.send = async (text) => {
      f.sent.push(text);
      return new Promise<string>((resolve) => (release = resolve));
    };
    const first = automatic ? f.run() : f.chats.sendChat({ ...f.target, text: 'MANUAL' });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(automatic ? f.chats.sendChat({ ...f.target, text: 'MANUAL' }) : f.run());
    assert.deepEqual(f.sent, [automatic ? 'CHAIN_TASK' : 'MANUAL']);
    release('started');
    await first;
    assert.equal(f.stops(), 0);
  }
});
test('cancelling before admission preserves the old process and request ownership', async () => {
  const f = fixture(),
    before = f.live.request;
  const pending = f.run();
  f.cancel();
  await assert.rejects(pending, ContinuationCancelled);
  assert.equal(f.live.request, before);
  assert.deepEqual(f.sent, []);
  assert.equal(f.stops(), 0);
});
test('native refusal/handled input is not accepted as a started chain task and rolls back unadmitted claims in RU/EN', async (t) => {
  const original = i18n.language;
  t.after(() => i18n.changeLanguage(original));
  for (const language of ['ru', 'en']) {
    await i18n.changeLanguage(language);
    for (const disposition of ['handled', 'queued', undefined]) {
      const f = fixture(),
        before = f.live.request;
      f.chat.send = async () => disposition;
      await assert.rejects(
        f.run(),
        (error) =>
          error instanceof Error &&
          error.message === i18n.t('error.runHost.theNextAgentDidNotAccept'),
      );
      assert.equal(f.live.request, before);
      assert.equal(f.live.chain, undefined);
      assert.equal(f.live.automaticCheck, undefined);
      assert.equal(f.live.preserveProcessOnAdmissionCancel, undefined);
      assert.equal(f.stops(), 0);
    }
  }
});

test('a native preflight refusal after the input hook does not leave the idle recipient falsely running', async () => {
  const f = fixture();
  f.chat.send = async () => {
    f.live.sequence++;
    f.live.status = 'running';
    throw Error('Native preflight rejected');
  };
  await assert.rejects(f.run(), /Native preflight rejected/);
  assert.equal(f.live.status, 'waiting');
  assert.equal(f.live.request.autoContinue, false);
  assert.equal(f.live.automaticCheck, undefined);
  assert.equal(f.stops(), 0);
  assert.equal(f.chat.state.messages, f.history);
});
