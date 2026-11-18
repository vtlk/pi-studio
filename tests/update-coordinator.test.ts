import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('ru');
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateCoordinator } from '../src/main/updates/UpdateCoordinator.ts';
import { InvocationGate } from '../src/main/updates/InvocationGate.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';
import type { UpdateView } from '../src/shared/updates.ts';

const update: VerifiedUpdate = {
  offer: {
    version: '0.2.0-alpha.76',
    bytes: 100,
    notes: 'Controlled test release',
    releaseUrl: '',
  },
  manifest: {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: '0.2.0-alpha.76',
    platform: 'darwin',
    arch: 'arm64',
    minOs: '13.0.0',
    format: 'mac-zip',
    sourceCommit: 'a'.repeat(40),
    archive: {
      name: 'Pi-Studio-0.2.0-alpha.76-mac-arm64.zip',
      bytes: 100,
      unpackedBytes: 200,
      sha256: 'b'.repeat(64),
    },
  },
  archiveUrl: '',
  manifestUrl: '',
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(t: TestContext, reserve = false) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-updater-state-'));
  const gate = new InvocationGate();
  const state = {
    idle: true,
    now: 10000,
    downloads: 0,
    prepared: 0,
    disposed: 0,
    quits: 0,
    leases: 0,
    checks: 0,
    failCancel: false,
    failArm: false,
    failCommit: false,
    available: true,
    preventQuit: false,
    order: [] as string[],
    view: undefined as UpdateView | undefined,
    beforeFlush: undefined as (() => Promise<void>) | undefined,
    beforeArm: undefined as (() => Promise<void>) | undefined,
    beforeDownload: undefined as (() => Promise<void>) | undefined,
  };
  const coordinator = new UpdateCoordinator({
    target: { version: '0.2.0-alpha.75', platform: 'darwin', arch: 'arm64', osVersion: '15.0.0' },
    cacheRoot: root,
    publicKey: 'test dependency injection; cryptography has independent real-key tests',
    now: () => state.now,
    check: async () => {
      state.checks++;
      return state.available ? structuredClone(update) : undefined;
    },
    download: async ({ destination, progress, signal }) => {
      state.downloads++;
      await state.beforeDownload?.();
      signal.throwIfAborted();
      await writeFile(destination, 'inert fixture, not an executable package');
      progress(100);
      return { path: destination, root: 'Pi Studio.app', entryCount: 2, unpackedBytes: 200 };
    },
    installer: {
      prepare: async () => {
        state.prepared++;
        return {
          arm: async () => {
            state.order.push('arm');
            await state.beforeArm?.();
            if (state.failArm) throw new Error('Cannot arm helper');
          },
          commit: async () => {
            state.order.push('commit');
            if (state.failCommit) throw new Error('Cannot commit helper');
          },
          dispose: async () => {
            state.disposed++;
            state.order.push('dispose');
            if (state.failCancel) throw new Error('Cancellation uncertain');
          },
        };
      },
    },
    idle: () => state.idle,
    acquire: () => {
      const release = reserve ? gate.reserve(1000) : gate.acquire();
      if (!release) return undefined;
      state.leases++;
      return {
        ready: (signal) => release.whenIdle?.(signal) ?? Promise.resolve(),
        verify: () => {
          if (!state.idle) throw new Error('New work was admitted');
        },
        drainIdle: async () => {
          state.order.push('drain-idle');
        },
        release: () => {
          state.order.push('release');
          release();
        },
      };
    },
    flushMain: async (view) => {
      state.order.push('flush');
      state.view = view;
      await state.beforeFlush?.();
    },
    quit: () => {
      state.order.push('quit');
      state.quits++;
      if (state.preventQuit) coordinator.quitPrevented();
    },
  });
  t.after(async () => {
    state.failCancel = false;
    await coordinator.close();
    await rm(root, { recursive: true, force: true });
  });
  const permit = () => {
    coordinator.report({ saved: true });
    coordinator.wake();
    return coordinator.read().prepareToken!;
  };
  return { coordinator, state, gate, root, permit };
}

test('update consent is one flight; checks/read/later never download, saved+idle+exact acknowledgement precede one quit', async (t) => {
  const { coordinator, state, gate, root, permit } = await fixture(t);
  await coordinator.check();
  coordinator.read();
  assert.equal(state.downloads, 0);
  state.idle = false;
  const first = coordinator.request(),
    second = coordinator.request();
  assert.equal(first, second);
  await first;
  assert.equal(state.downloads, 1);
  assert.equal(state.prepared, 1);
  assert.equal(coordinator.read().phase, 'waiting');
  assert.equal(coordinator.read().prepareToken, undefined);
  coordinator.report({ saved: false });
  coordinator.wake();
  assert.equal(coordinator.read().prepareToken, undefined);
  state.idle = true;
  const token = permit();
  assert.ok(token);
  coordinator.report({ saved: true, token: 'stale' });
  await settle();
  assert.equal(state.leases, 0);
  coordinator.report({ saved: false, token });
  assert.equal(coordinator.read().prepareToken, undefined);
  const next = permit();
  assert.notEqual(next, token);
  coordinator.report({
    saved: true,
    token: next,
    view: { page: 'project', projectId: 'existing-project' },
  });
  await settle();
  await settle();
  assert.equal(state.quits, 1);
  assert.equal(state.leases, 1);
  assert.deepEqual(state.order, ['flush', 'drain-idle', 'arm', 'commit', 'quit']);
  assert.deepEqual(state.view, { page: 'project', projectId: 'existing-project' });
  await assert.rejects(
    gate.invoke(() => undefined),
    /перезапуска/,
  );
  await coordinator.request();
  assert.equal(state.downloads, 1);
  assert.deepEqual(await readdir(root), []); // Archive was discarded after installer preparation.
  await coordinator.close();
  assert.equal(state.disposed, 0); // Committed staging belongs to the helper.
});

test('new work while flushing or stale renderer readiness cancels before replacement and releases only after helper cancellation', async (t) => {
  for (const mode of ['new-work', 'renderer-lost', 'arm-error', 'commit-error']) {
    const { coordinator, state, gate, permit } = await fixture(t);
    await coordinator.request();
    const token = permit();
    const pending = deferred();
    state.beforeFlush = () => pending.promise;
    coordinator.report({ saved: true, token });
    await settle();
    if (mode === 'new-work') state.idle = false;
    if (mode === 'renderer-lost') state.now += 6000;
    if (mode === 'arm-error') state.failArm = true;
    if (mode === 'commit-error') state.failCommit = true;
    pending.resolve();
    await settle();
    await settle();
    assert.equal(state.quits, 0, mode);
    assert.equal(state.disposed, 1, mode);
    assert.equal(coordinator.read().phase, 'error', mode);
    assert.equal(coordinator.read().prepareToken, undefined);
    assert.ok(state.order.indexOf('dispose') < state.order.indexOf('release'));
    assert.equal(await gate.invoke(() => 'working-old-app'), 'working-old-app');
  }
});

test('uncertain helper cancellation retains the frozen lease; successful retry cancels it before preparing again', async (t) => {
  const { coordinator, state, gate, permit } = await fixture(t);
  await coordinator.request();
  state.failArm = true;
  state.failCancel = true;
  const token = permit();
  coordinator.report({ saved: true, token });
  await settle();
  await settle();
  assert.equal(state.quits, 0);
  assert.equal(coordinator.read().phase, 'error');
  assert.equal(coordinator.read().prepareToken, token);
  await assert.rejects(
    gate.invoke(() => undefined),
    /перезапуска/,
  );
  state.failArm = false;
  state.failCancel = false;
  await coordinator.request();
  assert.equal(coordinator.read().phase, 'waiting');
  assert.equal(state.downloads, 2);
  assert.equal(await gate.invoke(() => 'unfrozen'), 'unfrozen');
});

test('revoked candidate sends no download; closing during download aborts and clears owned staging without acquiring a lease', async (t) => {
  const { coordinator, state, root } = await fixture(t);
  await coordinator.check();
  state.available = false;
  await coordinator.request();
  assert.equal(state.downloads, 0);
  assert.equal(coordinator.read().phase, 'error');
  state.available = true;
  const pending = deferred();
  state.beforeDownload = () => pending.promise;
  const work = coordinator.request();
  await settle();
  const closing = coordinator.close();
  pending.resolve();
  await work;
  await closing;
  assert.equal(state.quits, 0);
  assert.equal(state.leases, 0);
  assert.deepEqual(await readdir(root), []);
});

test('stale nonce and in-flight native action cannot grant an installation lease; no arbitrary paths cross readiness', async (t) => {
  const { coordinator, gate, permit, state } = await fixture(t);
  await coordinator.request();
  const pending = deferred();
  const operation = gate.invoke(() => pending.promise);
  const token = permit();
  coordinator.report({ saved: true, token });
  assert.equal(state.leases, 0);
  assert.equal(coordinator.read().prepareToken, undefined);
  pending.resolve();
  await operation;
  const next = permit();
  assert.throws(
    () => coordinator.report({ saved: true, token: next, view: { page: 'unknown' as 'projects' } }),
    /состояние/,
  );
  assert.equal(state.leases, 0);
  state.now += 16000;
  coordinator.wake();
  coordinator.report({ saved: true, token: next });
  assert.equal(state.leases, 0);
});

test('an unsaved-window guard cancels the committed-but-not-exited helper without retrying quit', async (t) => {
  const { coordinator, state, gate, permit } = await fixture(t);
  await coordinator.request();
  state.preventQuit = true;
  const token = permit();
  coordinator.report({ saved: true, token });
  await settle();
  await settle();
  assert.equal(state.quits, 1);
  assert.equal(state.disposed, 1);
  assert.equal(coordinator.read().phase, 'error');
  assert.match(coordinator.read().message!, /не сохранены/);
  assert.equal(coordinator.read().prepareToken, undefined);
  assert.equal(
    await gate.invoke(() => 'old application still works'),
    'old application still works',
  );
});

test('an in-flight background poll cannot starve installation or cycle the renderer token', async (t) => {
  const { coordinator, state, gate, permit } = await fixture(t, true);
  await coordinator.request();
  const pending = deferred();
  const reading = gate.invoke(() => pending.promise);
  const token = permit();
  coordinator.report({ saved: true, token });
  for (let i = 0; i < 5; i++) {
    coordinator.report({ saved: true });
    coordinator.wake();
    await settle();
    assert.equal(coordinator.read().prepareToken, token);
    assert.equal(coordinator.read().phase, 'installing');
    assert.equal(state.leases, 1);
    assert.equal(state.quits, 0);
  }
  await assert.rejects(
    gate.invoke(() => {
      throw Error('New polling entered');
    }),
  );
  pending.resolve();
  await reading;
  await settle();
  await settle();
  assert.equal(state.quits, 1);
  assert.deepEqual(state.order, ['flush', 'drain-idle', 'arm', 'commit', 'quit']);
});
test('work admitted before the gate reservation is rechecked after waiting, without stopping it', async (t) => {
  const { coordinator, state, gate, permit } = await fixture(t, true);
  await coordinator.request();
  const pending = deferred();
  const reading = gate.invoke(() => pending.promise);
  const token = permit();
  coordinator.report({ saved: true, token });
  state.idle = false;
  pending.resolve();
  await reading;
  await settle();
  await settle();
  assert.equal(state.quits, 0);
  assert.equal(coordinator.read().phase, 'error');
  assert.ok(!state.order.includes('drain-idle'));
  assert.equal(await gate.invoke(() => 42), 42);
});
test('closing while waiting for a native poll cancels the reservation and never commits an update', async (t) => {
  const { coordinator, state, gate, permit } = await fixture(t, true);
  await coordinator.request();
  const pending = deferred();
  const reading = gate.invoke(() => pending.promise);
  const token = permit();
  coordinator.report({ saved: true, token });
  await coordinator.close();
  assert.equal(state.quits, 0);
  assert.ok(!state.order.includes('commit'));
  pending.resolve();
  await reading;
  assert.equal(await gate.invoke(() => 7), 7);
});
