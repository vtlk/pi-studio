import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NtExecutable } from 'pe-library';
import { brandWindowsExecutable, verifyWindowsIcon } from '../scripts/windows-icon.mjs';
test('Windows PE executable embeds every branded icon size rather than the Electron icon', async () => {
  const ico = await readFile('public/branding/pi-studio.ico');
  assert.equal(ico.readUInt16LE(4), 7);
  const sizes = Array.from({ length: 7 }, (_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
  const executable = brandWindowsExecutable(
    Buffer.from(NtExecutable.createEmpty(false).generate()),
    ico,
  );
  assert.equal(verifyWindowsIcon(executable, ico), 1);
});
