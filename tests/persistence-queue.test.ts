import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PersistenceQueue,
  type PendingEdit,
} from '../src/renderer/shared/storage/persistenceQueue.ts';
import type { SectionSaveResult, StorageSection } from '../src/shared/storage.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(write: (key: StorageSection, edit: PendingEdit) => Promise<SectionSaveResult>) {
  const events: unknown[] = [];
  const queue = new PersistenceQueue({
    write,
    saved: (key, value) => events.push(['saved', key, value]),
    conflict: (key) => events.push(['conflict', key]),
    error: (error) => events.push(['error', error]),
    changed: (pending) => events.push(['pending', pending]),
    settled: () => events.push(['settled']),
  });
  return { queue, events };
}

test('writes serialize, share a flush task and rebase typing on the value main accepted', async () => {
  const first = deferred<SectionSaveResult>();
  const calls: unknown[] = [];
  const { queue } = fixture(async (key, edit) => {
    calls.push([key, edit]);
    if (calls.length === 1) return first.promise;
    return { saved: true, value: edit.value };
  });
  queue.enqueue('baseInstruction', 'A', 'old');
  const task = queue.flush();
  assert.equal(queue.writing, true);
  assert.equal(queue.flush(), task);
  await Promise.resolve();
  queue.enqueue('baseInstruction', 'AB', 'A');
  queue.enqueue('baseInstruction', 'ABC', 'AB');
  queue.enqueue('piPath', '/new/pi', '/old/pi');
  assert.equal(calls.length, 1);
  first.resolve({ saved: true, value: 'A-normalized' });
  await task;
  assert.deepEqual(calls, [
    ['baseInstruction', { base: 'old', value: 'A' }],
    ['baseInstruction', { base: 'A-normalized', value: 'ABC' }],
    ['piPath', { base: '/old/pi', value: '/new/pi' }],
  ]);
  assert.equal(queue.size, 0);
  assert.equal(queue.writing, false);
});

test('stale response retains the latest draft, blocks retries and resumes only after explicit reload', async () => {
  const first = deferred<SectionSaveResult>();
  const calls: unknown[] = [];
  const { queue, events } = fixture(async (key, edit) => {
    calls.push([key, edit]);
    return calls.length === 1 ? first.promise : { saved: true, value: edit.value };
  });
  queue.enqueue('agents', ['local'], ['original']);
  const task = queue.flush();
  await Promise.resolve();
  queue.enqueue('agents', ['newest draft'], ['local']);
  queue.enqueue('resources', ['resource'], []);
  first.resolve({ saved: false, value: ['changed in Pi'] });
  await task;
  const chosen = queue.get('agents');
  assert.deepEqual(chosen, { base: ['original'], value: ['newest draft'] });
  assert.equal(queue.size, 2);
  await queue.flush();
  assert.equal(calls.length, 1);
  assert.ok(
    events.some((event) => JSON.stringify(event) === JSON.stringify(['conflict', 'agents'])),
  );
  queue.enqueue('agents', ['typed while reloading'], ['newest draft']);
  assert.equal(
    queue.discard('agents', chosen),
    false,
    'A new draft must never be discarded by an older reload',
  );
  assert.equal(queue.discard('agents', queue.get('agents')), true);
  await queue.flush();
  assert.equal(queue.size, 0);
  assert.deepEqual(calls[1], ['resources', { base: [], value: ['resource'] }]);
});

test('a failed write retains its base/draft and can be retried without losing pending edits', async () => {
  const error = new Error('Disk unavailable');
  let calls = 0;
  const { queue, events } = fixture(async (_key, edit) => {
    if (++calls === 1) throw error;
    return { saved: true, value: edit.value };
  });
  queue.enqueue('baseInstruction', 'draft', 'base');
  await queue.flush();
  assert.equal(queue.writing, false);
  assert.deepEqual(queue.get('baseInstruction'), { base: 'base', value: 'draft' });
  assert.ok(
    events.some((event) => Array.isArray(event) && event[0] === 'error' && event[1] === error),
  );
  queue.enqueue('baseInstruction', 'newer draft', 'draft');
  await queue.flush();
  assert.equal(calls, 2);
  assert.deepEqual(events.at(-1), ['pending', false]);
});

test('an in-flight write cannot have its draft discarded and an empty queue writes nothing', async () => {
  const held = deferred<SectionSaveResult>();
  const { queue } = fixture(() => held.promise);
  await queue.flush();
  queue.enqueue('agents', [], ['base']);
  const draft = queue.get('agents');
  const task = queue.flush();
  assert.equal(queue.discard('agents', draft), false);
  held.resolve({ saved: true, value: [] });
  await task;
  assert.equal(queue.has('agents'), false);
});
