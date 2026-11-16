import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('ru');
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeUpdates } from '../src/main/updates/NativeUpdates.ts';
import { UpdateCoordinator } from '../src/main/updates/UpdateCoordinator.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';
const settle = () => new Promise<void>((r) => setImmediate(r));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const offer: VerifiedUpdate = {
  offer: { version: '0.2.0-alpha.79', bytes: 1, notes: 'Unit control fixture', releaseUrl: '' },
  manifest: {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: '0.2.0-alpha.79',
    platform: 'darwin',
    arch: 'arm64',
    minOs: '13.0.0',
    format: 'mac-zip',
    sourceCommit: 'a'.repeat(40),
    archive: {
      name: 'Pi-Studio-0.2.0-alpha.79-mac-arm64.zip',
      bytes: 1,
      unpackedBytes: 1,
      sha256: 'b'.repeat(64),
    },
  },
  archiveUrl: '',
  manifestUrl: '',
};
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-manual-update-'));
  const state = {
    checks: 0,
    downloads: 0,
    available: false,
    error: false,
    hold: undefined as ReturnType<typeof deferred> | undefined,
  };
  const coordinator = new UpdateCoordinator({
    target: { version: '0.2.0-alpha.78', platform: 'darwin', arch: 'arm64', osVersion: '15.0.0' },
    cacheRoot: root,
    publicKey: 'Explicit control fixture; signing is covered independently',
    check: async () => {
      state.checks++;
      await state.hold?.promise;
      if (state.error) throw Error('Controlled network failure');
      return state.available ? offer : undefined;
    },
    download: async () => {
      state.downloads++;
    },
    installer: {
      prepare: async () => ({
        arm: async () => {
          throw Error('No arm');
        },
        commit: async () => {
          throw Error('No commit');
        },
        dispose: async () => {},
      }),
    },
    idle: () => true,
    acquire: () => undefined,
    flushMain: async () => {
      throw Error('No flush');
    },
    quit: () => {
      throw Error('No quit');
    },
  });
  const updates = new NativeUpdates({
    version: '0.2.0-alpha.78',
    userData: root,
    target: join(root, 'app'),
    coordinator,
    folder: async () => root,
    flush: async () => {},
    releaseStartup: () => {},
    quit: () => {
      throw Error('No quit');
    },
  });
  t.after(async () => {
    await updates.close();
    await rm(root, { recursive: true, force: true });
  });
  return { state, coordinator, updates };
}
test('manual checks join the active request, carry one-use UI notices and get fresh results before the hourly deadline', async (t) => {
  const { state, updates } = await fixture(t);
  state.hold = deferred();
  const first = updates.check();
  await settle();
  const older = updates.read().manualCheckToken!;
  assert.equal(updates.read().phase, 'checking');
  const second = updates.check();
  await settle();
  const latest = updates.read().manualCheckToken!;
  assert.notEqual(older, latest);
  assert.equal(state.checks, 1);
  await updates.report({ saved: false, manualCheckToken: older });
  assert.equal(
    updates.read().manualCheckToken,
    latest,
    'Stale ACK never consumes a newer menu action',
  );
  await updates.report({ saved: false, manualCheckToken: latest });
  assert.equal(updates.read().manualCheckToken, undefined);
  state.hold.resolve();
  await Promise.all([first, second]);
  assert.equal(updates.read().phase, 'idle');
  assert.ok(updates.read().checkedAt);
  state.hold = undefined;
  state.available = true;
  await updates.check();
  assert.equal(state.checks, 2);
  assert.equal(updates.read().offer?.version, '0.2.0-alpha.79');
  assert.equal(state.downloads, 0, 'Checking never authorizes installation');
});
test('background results do not open a manual result and explicit check errors are not current-version success', async (t) => {
  const { state, coordinator, updates } = await fixture(t);
  coordinator.start();
  await settle();
  await settle();
  assert.equal(updates.read().phase, 'idle');
  assert.equal(updates.read().manualCheckToken, undefined);
  state.error = true;
  await updates.check();
  await settle();
  assert.equal(updates.read().phase, 'error');
  assert.match(updates.read().message!, /Controlled network failure/);
  assert.ok(updates.read().manualCheckToken);
  assert.equal(state.downloads, 0);
});
test('manual check during an authorized download/wait shows that operation without a new check or download', async (t) => {
  const { state, coordinator, updates } = await fixture(t);
  state.available = true;
  await coordinator.check();
  await coordinator.request();
  assert.equal(updates.read().phase, 'waiting');
  const before = { checks: state.checks, downloads: state.downloads };
  await updates.check();
  assert.equal(updates.read().phase, 'waiting');
  assert.deepEqual({ checks: state.checks, downloads: state.downloads }, before);
});
test('a development runtime without a production coordinator never claims its version is up to date', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-dev-update-'));
  const updates = new NativeUpdates({
    version: 'dev',
    userData: root,
    target: join(root, 'app'),
    folder: async () => root,
    flush: async () => {},
    releaseStartup: () => {},
    quit: () => {},
  });
  t.after(async () => {
    await updates.close();
    await rm(root, { recursive: true, force: true });
  });
  const result = await updates.check();
  assert.equal(result.phase, 'error');
  assert.match(result.message!, /установленной версии/);
});
