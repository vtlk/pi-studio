import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateZip, windowsEntries, type ZipFixtureEntry } from './helpers/updateZip.ts';
import { inspectUpdateArchive } from '../src/main/updates/archive.ts';
import { downloadVerifiedUpdate } from '../src/main/updates/download.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';

test('ZIP preflight accepts complete portable apps, rejects traversal, duplicate/local-header/special-file attacks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pistudio-update-zip-'));
  const file = join(directory, 'fixture.zip');
  try {
    const valid = updateZip(windowsEntries);
    await writeFile(file, valid);
    const result = await inspectUpdateArchive(file, 'win32');
    assert.equal(result.entryCount, 2);
    const cancelledInspection = new AbortController();
    cancelledInspection.abort();
    await assert.rejects(
      inspectUpdateArchive(file, 'win32', undefined, cancelledInspection.signal),
      /abort/i,
    );
    assert.equal(
      result.unpackedBytes,
      windowsEntries.reduce((total, item) => total + Buffer.byteLength(item.text!), 0),
    );
    await assert.rejects(inspectUpdateArchive(file, 'win32', result.unpackedBytes - 1), /размер/);
    await assert.rejects(inspectUpdateArchive(file, 'win32', result.unpackedBytes + 1), /размера/);
    const invalid: ZipFixtureEntry[][] = [
      [{ name: '../escape', text: 'no' }],
      [{ name: 'Pi Studio/../escape' }],
      [{ name: 'Pi Studio/a\\escape' }],
      [{ name: 'Pi Studio/x:stream' }],
      [{ name: 'Pi Studio/CON.txt' }],
      [{ name: 'Pi Studio/bad. ' }],
      [{ name: 'Pi Studio/link', text: '../../escape', mode: 0o120777 }],
      [{ name: 'Pi Studio/device', mode: 0o020666 }],
      [{ name: 'Pi Studio/setuid', mode: 0o104755 }],
      [{ name: 'Pi Studio/bad-directory/', text: 'data', mode: 0o040755 }],
      [{ name: windowsEntries[0].name, localName: 'different' }],
      [{ name: windowsEntries[0].name.toUpperCase(), text: 'duplicate on macOS/NTFS' }],
      [
        { name: 'Pi Studio/parent', text: 'file' },
        { name: 'Pi Studio/parent/child', text: 'no' },
      ],
      [{ name: 'Pi Studio/encrypted', flags: 0x801 }],
    ];
    for (const extra of invalid) {
      await writeFile(file, updateZip([...windowsEntries, ...extra]));
      await assert.rejects(inspectUpdateArchive(file, 'win32'), undefined, extra[0].name);
    }
    await writeFile(file, updateZip([{ name: 'Pi Studio/other.txt', text: 'no application' }]));
    await assert.rejects(inspectUpdateArchive(file, 'win32'), /программу/);
    assert.deepEqual(await readdir(directory), ['fixture.zip']); // Inspection never extracts.
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('macOS framework symlinks resolve only inside the app; chains/cycles and entries beneath links are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pistudio-update-link-'));
  const file = join(directory, 'fixture.zip');
  const base: ZipFixtureEntry[] = [
    { name: 'Pi Studio.app/Contents/MacOS/Pi Studio', text: 'inert' },
    { name: 'Pi Studio.app/Contents/Resources/app/package.json', text: '{}' },
    { name: 'Pi Studio.app/Contents/Frameworks/F/Versions/A/F', text: 'inert framework' },
    { name: 'Pi Studio.app/Contents/Frameworks/F/Versions/Current', text: 'A', mode: 0o120777 },
    { name: 'Pi Studio.app/Contents/Frameworks/F/F', text: 'Versions/Current/F', mode: 0o120777 },
  ];
  try {
    await writeFile(file, updateZip(base));
    assert.equal((await inspectUpdateArchive(file, 'darwin')).entryCount, 5);
    for (const extra of [
      [{ name: 'Pi Studio.app/link', text: '../outside', mode: 0o120777 }],
      [
        { name: 'Pi Studio.app/a', text: 'b', mode: 0o120777 },
        { name: 'Pi Studio.app/b', text: 'a', mode: 0o120777 },
      ],
      [{ name: 'Pi Studio.app/missing', text: 'no-target', mode: 0o120777 }],
      [
        {
          name: 'Pi Studio.app/Contents/Frameworks/F/Versions/Current/child',
          text: 'writes through symlink',
        },
      ],
    ]) {
      await writeFile(file, updateZip([...base, ...extra]));
      await assert.rejects(inspectUpdateArchive(file, 'darwin'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('explicit update streams verified bytes to owned staging; no space, revocation, hash/size/cancel never replace an app', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pistudio-update-download-'));
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const bytes = updateZip(windowsEntries);
  const update: VerifiedUpdate = {
    manifest: {
      schema: 1,
      appId: 'studio.pi.desktop',
      version: '0.2.0-alpha.76',
      platform: 'win32',
      arch: 'x64',
      minOs: '10.0.0',
      sourceCommit: 'a'.repeat(40),
      format: 'windows-portable-zip',
      archive: {
        name: 'Pi-Studio-0.2.0-alpha.76-win-x64.zip',
        bytes: bytes.length,
        unpackedBytes: windowsEntries.reduce(
          (total, item) => total + Buffer.byteLength(item.text!),
          0,
        ),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
    offer: { version: '0.2.0-alpha.76', notes: '', releaseUrl: '', bytes: bytes.length },
    manifestUrl:
      'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.76/metadata.update.json',
    archiveUrl: 'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.76/app.zip',
  };
  const payload = Buffer.from(JSON.stringify(update.manifest));
  const metadata = Buffer.from(
    JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, pair.privateKey).toString('base64'),
    }),
  );
  const destination = join(directory, 'package.zip');
  let calls = 0,
    downloaded = 0;
  const normal: typeof fetch = async (url) => {
    calls++;
    return new Response(String(url) === update.manifestUrl ? metadata : bytes);
  };
  const options = {
    update,
    publicKey,
    destination,
    signal: new AbortController().signal,
    progress: (count: number) => {
      downloaded = count;
    },
    fetch: normal,
    freeSpace: async () => 10 * 1024 ** 3,
  };
  try {
    await assert.rejects(downloadVerifiedUpdate({ ...options, freeSpace: async () => 1 }), /места/);
    assert.equal(calls, 0);
    const valid = await downloadVerifiedUpdate(options);
    assert.equal(valid.entryCount, 2);
    assert.equal(downloaded, bytes.length);
    assert.deepEqual(await readFile(destination), bytes);
    // A second request must not overwrite even its own prior completed staging file.
    await assert.rejects(downloadVerifiedUpdate(options), /EEXIST/);
    assert.deepEqual(await readFile(destination), bytes);
    await rm(destination);
    const sameLengthCorrupted = Buffer.from(bytes);
    sameLengthCorrupted[40] ^= 1;
    for (const bad of [
      sameLengthCorrupted,
      Buffer.from('corrupted'),
      Buffer.concat([bytes, Buffer.from('extra')]),
      bytes.subarray(0, bytes.length - 1),
    ]) {
      await assert.rejects(
        downloadVerifiedUpdate({
          ...options,
          fetch: async (url) => new Response(String(url) === update.manifestUrl ? metadata : bad),
        }),
      );
      assert.deepEqual(await readdir(directory), []);
    }
    await assert.rejects(
      downloadVerifiedUpdate({
        ...options,
        fetch: async () => new Response(null, { status: 404 }),
      }),
      /закрыт/,
    );
    assert.deepEqual(await readdir(directory), []);
    const cancelled = new AbortController();
    await assert.rejects(
      downloadVerifiedUpdate({
        ...options,
        signal: cancelled.signal,
        progress: () => cancelled.abort(),
      }),
      /abort/i,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
