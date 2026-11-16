import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { installerFixture } from './helpers/nativeUpdateInstaller.ts';
import { NativeUpdateInstaller } from '../src/main/updates/NativeUpdateInstaller.ts';
import { writeInventory } from '../bundled/update-helper/inventory.mjs';

test(
  'native preparation verifies/extracts program-only staging; armed commit waits for actual exit and can cancel safely',
  { timeout: 10000 },
  async (t) => {
    const f = await installerFixture(t),
      signal = new AbortController().signal;
    const prepared = await f.installer.prepare(f.archive, f.manifest, signal);
    f.track(prepared);
    assert.equal((await f.stages()).length, 1);
    await prepared.arm();
    await prepared.commit();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
      JSON.parse(await readFile(join(f.target, 'Contents/Resources/app/package.json'), 'utf8'))
        .version,
      '0.2.0-alpha.76',
    );
    await prepared.dispose();
    await prepared.dispose();
    assert.deepEqual(await f.stages(), []);
    assert.deepEqual(await readdir(join(f.userData, 'updates/transactions')), []);
  },
);
test('preparation rejects unsafe data placement, app edits, wrong OS/version/hash, insufficient space and abort', async (t) => {
  const f = await installerFixture(t),
    signal = new AbortController().signal;
  await assert.rejects(
    f.installer.prepare(f.archive, { ...f.manifest, arch: 'x64' }, signal),
    /не подходит/,
  );
  await assert.rejects(
    f.installer.prepare(f.archive, { ...f.manifest, version: f.options.version }, signal),
    /не подходит/,
  );
  await assert.rejects(
    f.installer.prepare(
      f.archive,
      { ...f.manifest, archive: { ...f.manifest.archive, sha256: '0'.repeat(64) } },
      signal,
    ),
    /Пакет изменился/,
  );
  const noSpace = new NativeUpdateInstaller({ ...f.options, freeSpace: async () => 0 });
  await assert.rejects(noSpace.prepare(f.archive, f.manifest, signal), /Недостаточно места/);
  const unsafe = new NativeUpdateInstaller({
    ...f.options,
    protectedRoots: () => [join(f.target, 'Contents')],
  });
  await assert.rejects(unsafe.prepare(f.archive, f.manifest, signal), /внутри программы/);
  await writeFile(join(f.target, 'materials.txt'), 'USER CONTENT');
  await assert.rejects(f.installer.prepare(f.archive, f.manifest, signal), /опись/);
  assert.equal(await readFile(join(f.target, 'materials.txt'), 'utf8'), 'USER CONTENT');
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(f.installer.prepare(f.archive, f.manifest, cancelled.signal), /abort/i);
  assert.deepEqual(await f.stages(), []);
});
test('a late user file blocks final arming without discarding user data', async (t) => {
  const f = await installerFixture(t),
    signal = new AbortController().signal;
  const prepared = await f.installer.prepare(f.archive, f.manifest, signal);
  f.track(prepared);
  await writeFile(join(f.target, 'my materials.txt'), 'USER DATA');
  await assert.rejects(prepared.arm(), /changed or additional/);
  await prepared.dispose();
  assert.equal(await readFile(join(f.target, 'my materials.txt'), 'utf8'), 'USER DATA');
});
test('candidate signature rejection or internal helper runtime never alters the installed program', async (t) => {
  const f = await installerFixture(t),
    signal = new AbortController().signal;
  const badSigner = new NativeUpdateInstaller({
    ...f.options,
    verify: async () => {
      throw new Error('different publisher');
    },
  });
  await assert.rejects(badSigner.prepare(f.archive, f.manifest, signal), /different publisher/);
  const internalNode = join(f.target, 'node');
  await writeFile(internalNode, 'inert');
  await rm(join(f.target, 'Contents/Resources/app/installation-files.json'));
  await writeInventory(f.target, 'darwin');
  await assert.rejects(
    new NativeUpdateInstaller({ ...f.options, helperNode: async () => internalNode }).prepare(
      f.archive,
      f.manifest,
      signal,
    ),
    /вне заменяемой/,
  );
  assert.deepEqual(await f.stages(), []);
  assert.equal(
    JSON.parse(await readFile(join(f.target, 'Contents/Resources/app/package.json'), 'utf8'))
      .version,
    f.options.version,
  );
});
