import test from 'node:test';
import assert from 'node:assert/strict';
import { resetChat } from '../src/main/pi/resetChat.ts';
import type { ChatState } from '../src/shared/chat.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import { t } from '../src/shared/i18n/index.ts';

function fixture() {
  const request = { projectId: 'p', agentId: 'a', runId: 'old' };
  const chat = { ...request, phase: 'ready', working: false, messages: [] } as unknown as ChatState;
  const run = { record: { runId: 'old' } } as PreparedRun;
  const calls: string[] = [],
    refreshing = new Set<string>();
  const state = {
    assertAvailable: () => assert.ok(!refreshing.has('p/a')),
    busy: () => false,
    chat: () => chat,
    run: () => run,
    refreshing,
    stop: async () => {
      calls.push('stop');
    },
    clear: async (selected: PreparedRun) => {
      assert.equal(selected, run);
      calls.push('clear');
    },
    forget: () => {
      calls.push('forget');
    },
    open: async () => {
      calls.push('open');
      return { runId: 'new' } as never;
    },
    changed: () => {},
  };
  return { request, chat, run, calls, state };
}
test('reset waits for selected process exit, then detaches binding and opens a fresh chat', async () => {
  const f = fixture();
  let release!: () => void;
  f.state.stop = async () => {
    f.calls.push('stop');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const action = resetChat(f.request, f.state);
  assert.deepEqual(f.calls, ['stop']);
  assert.ok(f.state.refreshing.has('p/a'));
  await assert.rejects(resetChat(f.request, f.state));
  release();
  assert.equal((await action).runId, 'new');
  assert.deepEqual(f.calls, ['stop', 'clear', 'forget', 'open']);
  assert.equal(f.state.refreshing.size, 0);
});
test('working, queued, sending, opening and interactive chats are preserved without stopping', async () => {
  for (const kind of ['working', 'steering', 'followUp', 'sending', 'opening', 'dialog']) {
    const f = fixture();
    if (kind === 'working') f.chat.working = true;
    if (kind === 'sending') f.state.busy = () => true;
    if (kind === 'opening') f.chat.phase = 'opening';
    if (kind === 'dialog') f.chat.dialog = { id: 'input', method: 'input', title: 'Question' };
    if (kind === 'steering' || kind === 'followUp')
      f.chat.queue = {
        steering: kind === 'steering' ? ['pending'] : [],
        followUp: kind === 'followUp' ? ['pending'] : [],
      };
    await assert.rejects(resetChat(f.request, f.state), { message: t('Chat.resetBusy') });
    assert.deepEqual(f.calls, []);
  }
});
test('stale confirmation cannot reset a replacement dialogue', async () => {
  const f = fixture();
  f.request.runId = 'previous';
  await assert.rejects(resetChat(f.request, f.state), { message: t('Chat.resetChanged') });
  assert.deepEqual(f.calls, []);
});
test('failed shutdown or persistence never forgets/reopens history; failed fresh opening releases admission', async () => {
  for (const stage of ['stop', 'clear', 'open'] as const) {
    const f = fixture();
    f.state[stage] = async () => {
      throw Error('fixture failure');
    };
    await assert.rejects(resetChat(f.request, f.state), /fixture failure/);
    assert.equal(f.state.refreshing.size, 0);
    if (stage !== 'open') assert.ok(!f.calls.includes('forget') && !f.calls.includes('open'));
  }
});
test('closed retained chats can start fresh, and historical error status is not a busy task', async () => {
  for (const phase of ['closed', 'error'] as const) {
    const f = fixture();
    f.chat.phase = phase;
    await resetChat(f.request, f.state);
    assert.deepEqual(f.calls, ['stop', 'clear', 'forget', 'open']);
  }
});
