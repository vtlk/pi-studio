import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { updateZip, windowsEntries } from './helpers/updateZip.ts';
import { extractUpdate } from '../src/main/updates/extractUpdate.ts';
import type { UpdateManifest } from '../src/shared/updates.ts';

function metadata(
  bytes: Buffer,
  size: number,
  platform: 'darwin' | 'win32' = 'win32',
): UpdateManifest {
  return {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: '0.2.0-alpha.77',
    minOs: '10.0.0',
    platform,
    arch: platform === 'darwin' ? 'arm64' : 'x64',
    format: platform === 'darwin' ? 'mac-zip' : 'windows-portable-zip',
    sourceCommit: 'a'.repeat(40),
    archive: {
      name: 'fixture.zip',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      unpackedBytes: size,
    },
  };
}
test('extraction writes exact preflighted file bytes, rejects CRC corruption and never follows archive symlink parents', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-update-extract-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = updateZip(windowsEntries),
    archive = join(root, 'fixture.zip');
  const manifest = metadata(
    bytes,
    windowsEntries.reduce((total, item) => total + Buffer.byteLength(item.text!), 0),
  );
  await writeFile(archive, bytes);
  const path = await extractUpdate(
    archive,
    join(root, 'valid'),
    manifest,
    new AbortController().signal,
  );
  assert.equal(await readFile(join(path, 'Pi Studio.exe'), 'utf8'), windowsEntries[0].text);
  const corrupt = Buffer.from(bytes),
    offset = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE((corrupt.readUInt32LE(offset + 16) ^ 1) >>> 0, offset + 16);
  await writeFile(archive, corrupt);
  await assert.rejects(
    extractUpdate(archive, join(root, 'corrupt'), manifest, new AbortController().signal),
    /CRC/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    extractUpdate(archive, join(root, 'cancelled'), manifest, cancelled.signal),
    /abort/i,
  );
});
test(
  'macOS extraction preserves executable modes and safe internal framework symlinks',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-update-extract-links-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const entries = [
      { name: 'Pi Studio.app/Contents/MacOS/Pi Studio', text: 'inert executable', mode: 0o100755 },
      { name: 'Pi Studio.app/Contents/Resources/app/package.json', text: '{}' },
      { name: 'Pi Studio.app/Contents/Frameworks/F/Versions/A/F', text: 'inert framework' },
      { name: 'Pi Studio.app/Contents/Frameworks/F/Versions/Current', text: 'A', mode: 0o120777 },
    ];
    const bytes = updateZip(entries),
      archive = join(root, 'fixture.zip');
    await writeFile(archive, bytes);
    const manifest = metadata(
      bytes,
      entries.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0),
      'darwin',
    );
    const path = await extractUpdate(
      archive,
      join(root, 'result'),
      manifest,
      new AbortController().signal,
    );
    assert.equal((await lstat(join(path, 'Contents/MacOS/Pi Studio'))).mode & 0o777, 0o755);
    assert.equal(await readlink(join(path, 'Contents/Frameworks/F/Versions/Current')), 'A');
    assert.equal(
      await readFile(join(path, 'Contents/Frameworks/F/Versions/Current/F'), 'utf8'),
      'inert framework',
    );
  },
);
