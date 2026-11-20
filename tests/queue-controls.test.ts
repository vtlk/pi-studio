import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueControls } from '../bundled/pi-bridge/queue-controls.mjs';
import { projectChatQueue } from '../src/main/pi/chatProjection.ts';
import { chatQueue } from '../src/main/pi/chatQueueRpc.ts';

function fixture() {
  const texts = { steering: [] as string[], followUp: [] as string[] };
  const messages = {
    steering: [] as Record<string, unknown>[],
    followUp: [] as Record<string, unknown>[],
  };
  const listeners = new Set<(event: { type: string }) => void>();
  const official: unknown[] = [],
    published: unknown[] = [];
  const session = {
    agent: {
      steeringQueue: { messages: messages.steering },
      followUpQueue: { messages: messages.followUp },
    },
    getSteeringMessages: () => texts.steering,
    getFollowUpMessages: () => texts.followUp,
    _queuedMessagesWithImages: new Set(),
    _emitQueueUpdate: () => {
      official.push(structuredClone(texts));
      for (const l of listeners) l({ type: 'queue_update' });
    },
    subscribe: (fn: (event: { type: string }) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const controls = createQueueControls(session, (event: unknown) => published.push(event));
  const add = (text: string, kind: 'steering' | 'followUp' = 'followUp', image?: object) => {
    const message = {
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text }, ...(image ? [image] : [])],
    };
    texts[kind].push(text);
    session._emitQueueUpdate();
    messages[kind].push(message);
    if (image) session._queuedMessagesWithImages.add(message);
    return message;
  };
  return { controls, session, add, texts, messages, official, published };
}

test('moving exactly one duplicate to Steer preserves all other native objects, images and order without replay', () => {
  const f = fixture(),
    image = { type: 'image', mimeType: 'image/png', data: 'SENTINEL' };
  const first = f.add('same'),
    selected = f.add('same', 'followUp', image),
    last = f.add('last');
  const snapshot = f.controls.snapshot();
  assert.equal(new Set(snapshot.items.map((item) => item.id)).size, 3);
  f.controls.action('steer', snapshot.items[1].id);
  assert.deepEqual(f.messages.followUp, [first, last]);
  assert.equal(f.messages.steering[0], selected);
  assert.equal((selected.content[1] as typeof image).data, 'SENTINEL');
  assert.ok(f.session._queuedMessagesWithImages.has(selected));
  const after = f.controls.snapshot();
  assert.equal(after.items[0].id, snapshot.items[1].id);
  assert.deepEqual(f.texts, { steering: ['same'], followUp: ['same', 'last'] });
  assert.deepEqual(f.official.at(-1), f.texts);
});

test('peek is read-only, editing/removing returns exact content and leaves neighboring/custom queue entries intact', () => {
  const f = fixture();
  const custom = { role: 'custom', content: 'Not a user input' };
  f.messages.followUp.push(custom);
  const selected = f.add('EDIT_ME', 'followUp', {
    type: 'image',
    mimeType: 'image/png',
    data: 'image-data',
  });
  const other = f.add('KEEP');
  const id = f.controls.snapshot().items[0].id;
  const peek = f.controls.action('peek', id);
  assert.equal(peek.text, 'EDIT_ME');
  assert.equal(f.messages.followUp[1], selected);
  const edited = f.controls.action('edit', id);
  assert.equal(edited.text, 'EDIT_ME');
  assert.deepEqual(edited.images, [selected.content[1]]);
  assert.deepEqual(f.messages.followUp, [custom, other]);
  assert.ok(!f.session._queuedMessagesWithImages.has(selected));
  const before = structuredClone(f.messages);
  assert.throws(() => f.controls.action('edit', id), /queue_changed/);
  assert.deepEqual(f.messages, before);
  f.controls.action('delete', f.controls.snapshot().items[0].id);
  assert.deepEqual(f.messages.followUp, [custom]);
  assert.deepEqual(f.texts.followUp, []);
});

test('already consumed duplicate never selects another equal-text input; incompatible SDK shape fails closed', () => {
  const f = fixture();
  f.add('same');
  f.add('same');
  const first = f.controls.snapshot().items[0].id;
  f.messages.followUp.shift();
  f.texts.followUp.shift(); // Native delivery already consumed it.
  assert.throws(() => f.controls.action('delete', first), /queue_changed/);
  assert.equal(f.messages.followUp.length, 1);
  f.texts.followUp[0] = 'out-of-sync';
  const before = structuredClone(f.messages);
  assert.throws(
    () => f.controls.action('delete', f.controls.snapshot().items[0]?.id),
    /queue_changed/,
  );
  assert.deepEqual(f.messages, before);
});

test('native enqueue snapshots publish after both SDK representations exist; UI identities validate duplicates and reject tampering', async () => {
  const f = fixture();
  f.add('same');
  f.add('same');
  await Promise.resolve();
  const published = f.published.at(-1) as {
    steering: string[];
    followUp: string[];
    items: unknown[];
  };
  const projected = projectChatQueue(published.steering, published.followUp, published.items);
  assert.equal(projected.items?.length, 2);
  assert.notEqual(projected.items![0].id, projected.items![1].id);
  assert.throws(() => projectChatQueue([], ['same'], projected.items));
  f.controls.close();
});

test('oversized edit refuses before mutation and a native queue echo retains current exact identities', () => {
  const f = fixture();
  f.add('x'.repeat(200001));
  const id = f.controls.snapshot().items[0].id;
  assert.throws(() => f.controls.action('peek', id), /queue_too_large/);
  assert.throws(() => f.controls.action('edit', id), /queue_too_large/);
  assert.equal(f.messages.followUp.length, 1);
  f.controls.action('delete', id);
  assert.equal(f.messages.followUp.length, 0);
});

test('official queue echo keeps verified IDs, changed queues discard stale IDs', () => {
  const previous = {
    steering: [],
    followUp: ['same', 'same'],
    items: [
      { id: 'first', kind: 'followUp' as const, text: 'same' },
      { id: 'second', kind: 'followUp' as const, text: 'same' },
    ],
  };
  const echo = chatQueue(previous, {
    type: 'queue_update',
    steering: [],
    followUp: ['same', 'same'],
  });
  assert.deepEqual(echo.items, previous.items);
  assert.equal(
    chatQueue(previous, { type: 'queue_update', steering: [], followUp: ['same'] }).items,
    undefined,
  );
});
