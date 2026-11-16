import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { transactionFixture, until } from './helpers/updateTransaction.ts';
import { identity, sameIdentity, exists, atomicJson } from '../bundled/update-helper/protocol.mjs';

// These fixtures execute POSIX shell launchers, not Windows programs.
const test = process.platform === 'win32' ? nativeTest.skip : nativeTest;

test(
  'detached helper requires commit and real previous exit, then swaps only the program and preserves user data',
  { timeout: 12000 },
  async (t) => {
    const f = await transactionFixture(t);
    const helper = f.run();
    await f.ready();
    assert.equal(sameIdentity(await identity(f.target), f.job.oldIdentity), true);
    await atomicJson(f.p.commit, { nonce: f.job.nonce });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
      sameIdentity(await identity(f.target), f.job.oldIdentity),
      true,
      'Live original process prevents replacement',
    );
    await f.closeParent();
    const result = await f.result();
    await helper.exited;
    assert.equal(result.status, 'committed');
    assert.equal(sameIdentity(await identity(f.target), f.job.newIdentity), true);
    assert.equal(await exists(f.p.previous), false);
    assert.equal(await readFile(join(f.userData, 'KEEP.json'), 'utf8'), '{"user":"UNCHANGED"}\n');
  },
);

test(
  'cancel and exiting without commit preserve the old program without launching a replacement',
  { timeout: 12000 },
  async (t) => {
    for (const mode of ['cancel', 'no-consent']) {
      const f = await transactionFixture(t);
      const helper = f.run();
      await f.ready();
      if (mode === 'cancel') await atomicJson(f.p.cancel, { nonce: f.job.nonce });
      else await f.closeParent();
      assert.equal((await f.result()).status, 'cancelled');
      await helper.exited;
      assert.equal(sameIdentity(await identity(f.target), f.job.oldIdentity), true);
      assert.equal(await exists(f.p.previous), false);
    }
  },
);

test(
  'failed and nonresponsive startup acknowledgements restore/reopen the old program after graceful startup abort',
  { timeout: 15000 },
  async (t) => {
    for (const mode of ['crash', 'no-health']) {
      const f = await transactionFixture(t, mode);
      const helper = f.run();
      await f.ready();
      await atomicJson(f.p.commit, { nonce: f.job.nonce });
      await f.closeParent();
      assert.equal((await f.result()).status, 'rolled-back');
      await helper.exited;
      assert.equal(sameIdentity(await identity(f.target), f.job.oldIdentity), true);
      await until(() => exists(join(f.userData, 'OLD_REOPENED')), Boolean);
      assert.equal(await readFile(join(f.userData, 'KEEP.json'), 'utf8'), '{"user":"UNCHANGED"}\n');
    }
  },
);

test(
  'a startup that ignores abort is never force-killed or overwritten; recovery retains the previous app',
  { timeout: 10000 },
  async (t) => {
    const f = await transactionFixture(t, 'wedged');
    const helper = f.run();
    await f.ready();
    await atomicJson(f.p.commit, { nonce: f.job.nonce });
    await f.closeParent();
    const result = await f.result();
    await helper.exited;
    assert.equal(result.status, 'recovery-required');
    assert.equal(result.reason, 'new-application-still-running');
    assert.equal(sameIdentity(await identity(f.p.previous), f.job.oldIdentity), true);
    const phase = JSON.parse(await readFile(f.p.phase, 'utf8'));
    assert.equal(phase.state, 'recovery-required');
  },
);

test(
  'supervisor recovers an abruptly terminated worker without quitting the live original application',
  { timeout: 10000 },
  async (t) => {
    const f = await transactionFixture(t);
    const helper = f.run();
    const ready = await f.ready();
    process.kill(ready.pid, 'SIGKILL'); // Owned test worker only; no GUI or user process.
    const result = await f.result();
    await helper.exited;
    assert.equal(result.status, 'failed');
    assert.equal(sameIdentity(await identity(f.target), f.job.oldIdentity), true);
    assert.equal(await exists(f.p.previous), false);
  },
);

test(
  'interrupted replacement and interrupted commit recover from the durable filesystem state',
  { timeout: 12000 },
  async (t) => {
    for (const mode of ['moving-next', 'committing']) {
      const f = await transactionFixture(t);
      await atomicJson(f.p.commit, { nonce: f.job.nonce });
      await f.closeParent();
      await mkdir(dirname(f.p.previous), { recursive: true });
      await rename(f.target, f.p.previous);
      if (mode === 'committing') {
        await rename(f.next, f.target);
        await rm(join(f.p.previous, 'Contents/Resources/app/fixture.mjs'));
      }
      await atomicJson(f.p.phase, { nonce: f.job.nonce, state: mode });
      const helper = f.run();
      const result = await f.result();
      await helper.exited;
      assert.equal(result.status, mode === 'committing' ? 'committed' : 'rolled-back');
      assert.equal(
        sameIdentity(
          await identity(f.target),
          mode === 'committing' ? f.job.newIdentity : f.job.oldIdentity,
        ),
        true,
      );
    }
  },
);

test(
  'an unrelated program placed at the target is preserved with the complete previous app for explicit recovery',
  { timeout: 10000 },
  async (t) => {
    const f = await transactionFixture(t);
    await f.closeParent();
    await mkdir(dirname(f.p.previous), { recursive: true });
    await rename(f.target, f.p.previous);
    await mkdir(f.target);
    await writeFile(join(f.target, 'FOREIGN'), 'KEEP');
    const helper = f.run();
    const result = await f.result();
    await helper.exited;
    assert.equal(result.status, 'recovery-required');
    assert.equal(await readFile(join(f.target, 'FOREIGN'), 'utf8'), 'KEEP');
    assert.equal(sameIdentity(await identity(f.p.previous), f.job.oldIdentity), true);
  },
);

test(
  'a user file added while waiting prevents replacement after the old process exits',
  { timeout: 10000 },
  async (t) => {
    const f = await transactionFixture(t),
      helper = f.run();
    await f.ready();
    await writeFile(join(f.target, 'MY MATERIAL.txt'), 'KEEP USER DATA');
    await atomicJson(f.p.commit, { nonce: f.job.nonce });
    await f.closeParent();
    assert.equal((await f.result()).status, 'failed');
    await helper.exited;
    assert.equal(await readFile(join(f.target, 'MY MATERIAL.txt'), 'utf8'), 'KEEP USER DATA');
    assert.equal(await exists(f.p.previous), false);
    await until(() => exists(join(f.userData, 'OLD_REOPENED')), Boolean);
  },
);
