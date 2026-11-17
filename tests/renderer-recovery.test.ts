import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererRecovery } from '../src/main/windows/RendererRecovery.ts';
const tick = () => new Promise<void>((done) => setImmediate(done));
function fixture() {
  let closed = false,
    loads = 0,
    prompts = 0,
    closes = 0,
    time = 0;
  let load = async () => {
    loads++;
  };
  let ask = async () => {
    prompts++;
    return false;
  };
  const reports: unknown[] = [];
  const recovery = new RendererRecovery({
    isClosed: () => closed,
    load: () => load(),
    askRetry: () => ask(),
    close: () => {
      closes++;
      closed = true;
    },
    report: async (failure) => {
      reports.push(failure);
    },
    now: () => time,
  });
  return {
    recovery,
    reports,
    counts: () => ({ loads, prompts, closes }),
    close: () => {
      closed = true;
    },
    advance: (ms: number) => {
      time += ms;
    },
    setLoad: (value: typeof load) => {
      load = value;
    },
    setAsk: (value: typeof ask) => {
      ask = value;
    },
  };
}
test('one unexpected exit recovers the view once without a dialog; duplicate events coalesce', async () => {
  const f = fixture();
  f.recovery.failed({ reason: 'killed', exitCode: 9 });
  f.recovery.failed({ reason: 'killed', exitCode: 9 });
  await tick();
  assert.deepEqual(f.counts(), { loads: 1, prompts: 0, closes: 0 });
  assert.deepEqual(f.reports, [{ reason: 'killed', exitCode: 9 }]);
  f.recovery.dispose();
});
test('disposal and intentional closing before the deferred task never reopen a window', async () => {
  for (const mode of ['dispose', 'closed']) {
    const f = fixture();
    f.recovery.failed({ reason: 'clean-exit' });
    if (mode === 'dispose') f.recovery.dispose();
    if (mode === 'closed') f.close();
    await tick();
    assert.deepEqual(f.counts(), { loads: 0, prompts: 0, closes: 0 });
  }
});
test('a repeated crash prompts instead of entering an automatic reload loop', async () => {
  const f = fixture();
  f.recovery.failed({ reason: 'oom' });
  await tick();
  f.recovery.failed({ reason: 'oom' });
  await tick();
  assert.deepEqual(f.counts(), { loads: 1, prompts: 1, closes: 1 });
  f.recovery.dispose();
});
test('an independent later failure can recover automatically again', async () => {
  const f = fixture();
  f.recovery.failed({ reason: 'crashed' });
  await tick();
  f.advance(60_001);
  f.recovery.failed({ reason: 'crashed' });
  await tick();
  assert.deepEqual(f.counts(), { loads: 2, prompts: 0, closes: 0 });
  f.recovery.dispose();
});
test('failed loads require explicit retries; closing during a prompt never loads again', async () => {
  const f = fixture();
  let attempts = 0,
    choices = 0;
  f.setLoad(async () => {
    attempts++;
    throw Error('fixture load failed');
  });
  f.setAsk(async () => {
    choices++;
    if (choices === 2) f.close();
    return true;
  });
  f.recovery.failed({ reason: 'load-failed' });
  await tick();
  assert.equal(attempts, 2);
  assert.equal(choices, 2);
  f.recovery.dispose();
});
test('another exit during loading is not lost even if load resolves successfully', async () => {
  const f = fixture();
  let finish!: () => void,
    loads = 0;
  f.setLoad(() => {
    loads++;
    return new Promise<void>((done) => {
      finish = done;
    });
  });
  f.recovery.failed({ reason: 'memory-eviction' });
  await tick();
  f.recovery.failed({ reason: 'crashed' });
  await tick();
  assert.equal(loads, 1);
  finish();
  await tick();
  assert.equal(f.counts().prompts, 1);
  assert.equal(f.counts().closes, 1);
  f.recovery.dispose();
});

test('even a clean renderer exit recovers when its window is still open', async () => {
  const f = fixture();
  f.recovery.failed({ reason: 'clean-exit', exitCode: 0 });
  await tick();
  assert.equal(f.counts().loads, 1);
  f.recovery.dispose();
});
test('failed optional diagnostic writes do not block recovery', async () => {
  let loads = 0;
  const recovery = new RendererRecovery({
    isClosed: () => false,
    load: async () => {
      loads++;
    },
    askRetry: async () => {
      assert.fail('Unexpected dialog');
    },
    close: () => {},
    report: async () => {
      throw Error('fixture disk full');
    },
  });
  recovery.failed({ reason: 'oom' });
  await tick();
  assert.equal(loads, 1);
  recovery.dispose();
});
