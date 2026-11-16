import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { transactionFixture, until } from './helpers/updateTransaction.ts';
import { atomicJson, exists, executable } from '../bundled/update-helper/protocol.mjs';
import { cleanupUpdate, cleanupFinishedUpdates } from '../src/main/updates/cleanupUpdate.ts';
import { saveUpdateView, restoreUpdateView } from '../src/main/updates/UpdateViewStore.ts';
import { resolveUpdateStartup } from '../src/main/updates/UpdateStartup.ts';
import { NativeUpdates } from '../src/main/updates/NativeUpdates.ts';

const test = process.platform === 'win32' ? nativeTest.skip : nativeTest;
test('an uncertain cleanup is visible and explicit retry removes only known staging after the conflict is resolved', async (t) => {
  const f = await transactionFixture(t);
  await mkdir(dirname(f.p.result), { recursive: true });
  await atomicJson(f.p.result, { nonce: f.job.nonce, status: 'failed' });
  const extra = join(f.stage, 'USER FILE.txt');
  await writeFile(extra, 'PRESERVE');
  const updates = new NativeUpdates({
    version: f.job.oldVersion,
    userData: f.userData,
    target: f.target,
    folder: async () => f.userData,
    flush: async () => {},
    releaseStartup: () => {},
    quit: () => {
      throw Error('Cleanup must not quit the app');
    },
  });
  t.after(() => updates.close());
  await updates.initialize();
  await until(async () => updates.read().maintenanceError, Boolean);
  assert.equal(await readFile(extra, 'utf8'), 'PRESERVE');
  const { rm } = await import('node:fs/promises');
  await rm(extra);
  await updates.request();
  await until(
    () => exists(f.stage),
    (value) => value === false,
  );
  assert.equal(updates.read().maintenanceError, undefined);
  assert.equal(await readFile(join(f.userData, 'KEEP.json'), 'utf8'), '{"user":"UNCHANGED"}\n');
});
test('post-restart readiness requires hydration and nonce; restores only the bound studio view and releases on commit', async (t) => {
  const f = await transactionFixture(t);
  await mkdir(dirname(f.p.previous), { recursive: true });
  await rename(f.target, f.p.previous);
  await rename(f.next, f.target);
  await mkdir(f.p.startups);
  await atomicJson(f.p.active, { id: f.job.id, target: f.target });
  await saveUpdateView(f.userData, f.job.oldVersion, f.job.version, f.userData, {
    page: 'project',
    projectId: 'exact-project',
  });
  assert.equal(await restoreUpdateView(f.job, join(f.root, 'different-studio')), undefined);
  let released = 0,
    flushed = 0;
  const resolved = await resolveUpdateStartup({
    appRoot: f.target,
    executable: executable(f.target, 'darwin'),
    version: f.job.version,
    userData: f.userData,
    argv: [`--pistudio-update=${f.job.id}`],
    quit: () => {
      throw Error('unexpected quit');
    },
  });
  assert.ok(resolved.startup);
  const updates = new NativeUpdates({
    startup: resolved.startup,
    version: f.job.version,
    userData: f.userData,
    target: f.target,
    folder: async () => f.userData,
    flush: async () => {
      flushed++;
    },
    releaseStartup: () => {
      released++;
    },
    quit: () => {
      throw Error('unexpected quit');
    },
  });
  t.after(() => updates.close());
  await updates.initialize();
  await updates.initialize();
  const initial = updates.read();
  assert.equal(initial.startup?.phase, 'starting');
  assert.deepEqual(initial.startup?.view, { page: 'project', projectId: 'exact-project' });
  await updates.report({ saved: true, hydrated: true, startupToken: 'stale' });
  await updates.report({ saved: false, hydrated: true, startupToken: initial.startup!.token });
  await updates.report({ saved: true, hydrated: false, startupToken: initial.startup!.token });
  assert.equal(await exists(f.p.health), false);
  assert.equal(flushed, 0);
  assert.equal(released, 0);
  await updates.report({ saved: true, hydrated: true, startupToken: initial.startup!.token });
  assert.equal(flushed, 1);
  await updates.report({ saved: true, hydrated: true, startupToken: initial.startup!.token });
  assert.equal(flushed, 1, 'Health readiness is acknowledged once');
  assert.equal(
    updates.read().startup?.view,
    undefined,
    'A later window cannot replay old navigation',
  );
  assert.equal(JSON.parse(await readFile(f.p.health, 'utf8')).pid, process.pid);
  await mkdir(dirname(f.p.result), { recursive: true });
  await atomicJson(f.p.result, { nonce: f.job.nonce, status: 'committed' });
  await resolved.startup.poll();
  await until(
    async () => released,
    (value) => value === 1,
  );
  assert.equal(updates.read().startup?.phase, 'committed');
  // The synthetic previous tree was not removed by a real helper: cleanup must retain it.
  assert.equal(await exists(f.p.previous), true);
});
test(
  'completed real helper transaction cleans only owned program staging after helper exit',
  { timeout: 12000 },
  async (t) => {
    const f = await transactionFixture(t),
      helper = f.run();
    await f.ready();
    await atomicJson(f.p.active, { id: f.job.id, target: f.target });
    await atomicJson(f.p.commit, { nonce: f.job.nonce });
    await f.closeParent();
    assert.equal((await f.result()).status, 'committed');
    await helper.exited;
    assert.equal(await cleanupUpdate(f.job), true);
    assert.equal(await exists(f.stage), false);
    assert.equal(await exists(f.p.journal), false);
    assert.equal(await exists(f.p.active), false);
    assert.equal(await readFile(join(f.userData, 'KEEP.json'), 'utf8'), '{"user":"UNCHANGED"}\n');
  },
);
test('cleanup refuses recovery copies, unknown stage files and a live helper; pointer-less finished journals are recoverable', async (t) => {
  const f = await transactionFixture(t);
  await mkdir(dirname(f.p.result), { recursive: true });
  await atomicJson(f.p.result, { nonce: f.job.nonce, status: 'failed' });
  await atomicJson(f.p.ready, { nonce: f.job.nonce, pid: process.pid });
  assert.equal(await cleanupUpdate(f.job), false, 'Live helper must finish before cleanup');
  await atomicJson(f.p.ready, { nonce: f.job.nonce, pid: 0 });
  await writeFile(join(f.stage, 'USER MATERIAL.txt'), 'KEEP');
  await assert.rejects(cleanupUpdate(f.job), /дополнительные файлы/);
  assert.equal(await readFile(join(f.stage, 'USER MATERIAL.txt'), 'utf8'), 'KEEP');
  const { rm } = await import('node:fs/promises');
  await rm(join(f.stage, 'USER MATERIAL.txt'));
  assert.equal(await cleanupFinishedUpdates(f.userData, f.target), true);
  assert.equal(await exists(f.stage), false);
});
