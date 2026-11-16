import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeInventory, verifyInventory } from '../bundled/update-helper/inventory.mjs';

test('portable inventory refuses changed, missing or added user files without deleting them', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-inventory-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'resources/app'), { recursive: true });
  await writeFile(join(root, 'Pi Studio.exe'), 'inert original');
  await writeInventory(root, 'win32');
  await verifyInventory(root, 'win32');
  await writeFile(join(root, 'Pi Studio.exe'), 'inert changed');
  await assert.rejects(verifyInventory(root, 'win32'), /changed or additional/);
  await writeFile(join(root, 'Pi Studio.exe'), 'inert original');
  await writeFile(join(root, 'my screenplay.txt'), 'USER CONTENT');
  await assert.rejects(verifyInventory(root, 'win32'), /changed or additional/);
  await rm(join(root, 'my screenplay.txt'));
  await rm(join(root, 'Pi Studio.exe'));
  await assert.rejects(verifyInventory(root, 'win32'), /changed or additional/);
});
test(
  'macOS inventory permits signature files generated after packaging but rejects new paths and changed links',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-inventory-mac-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'Contents/Resources/app'), { recursive: true });
    await writeFile(join(root, 'Contents/original'), 'inert');
    await symlink('original', join(root, 'Contents/current'));
    await writeInventory(root, 'darwin');
    await mkdir(join(root, 'Contents/_CodeSignature'));
    await writeFile(join(root, 'Contents/_CodeSignature/CodeResources'), 'codesign-generated');
    await verifyInventory(root, 'darwin');
    await writeFile(join(root, 'Contents/_CodeSignature/user-material.txt'), 'PRESERVE');
    await assert.rejects(verifyInventory(root, 'darwin'), /changed or additional/);
    await rm(join(root, 'Contents/_CodeSignature/user-material.txt'));
    await rm(join(root, 'Contents/current'));
    await symlink('elsewhere', join(root, 'Contents/current'));
    await assert.rejects(verifyInventory(root, 'darwin'), /changed or additional/);
    // This is only the file-preservation inventory; codesign must independently authenticate bytes.
  },
);
