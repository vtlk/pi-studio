import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  link,
  realpath,
  mkdir,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { updateZip, windowsEntries } from './helpers/updateZip.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';
import { downloadVerifiedUpdate } from '../src/main/updates/download.ts';
import { UpdateCoordinator } from '../src/main/updates/UpdateCoordinator.ts';
import {
  cleanupDownloads,
  prepareDownload,
  releaseDownload,
} from '../src/main/updates/cleanupDownloads.ts';

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-update-resume-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = updateZip(windowsEntries);
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const update: VerifiedUpdate = {
    manifest: {
      schema: 1,
      appId: 'studio.pi.desktop',
      version: '0.2.0-alpha.93',
      platform: 'win32',
      arch: 'x64',
      minOs: '10.0.0',
      sourceCommit: 'a'.repeat(40),
      format: 'windows-portable-zip',
      archive: {
        name: 'Pi-Studio-0.2.0-alpha.93-win-x64.zip',
        bytes: bytes.length,
        unpackedBytes: windowsEntries.reduce(
          (sum, entry) => sum + Buffer.byteLength(entry.text!),
          0,
        ),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
    offer: { version: '0.2.0-alpha.93', notes: '', releaseUrl: '', bytes: bytes.length },
    manifestUrl:
      'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.93/metadata.update.json',
    archiveUrl: 'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.93/package.zip',
  };
  const metadata = (manifest = update.manifest) => {
    const payload = Buffer.from(JSON.stringify(manifest));
    return Buffer.from(
      JSON.stringify({
        payload: payload.toString('base64'),
        signature: sign(null, payload, keys.privateKey).toString('base64'),
      }),
    );
  };
  const destination = join(root, 'package.zip');
  const progress: number[] = [],
    ranges: (string | null)[] = [];
  const partial = (offset: number) =>
    new Response(bytes.subarray(offset), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}`,
        'Content-Length': String(bytes.length - offset),
      },
    });
  const request: typeof fetch = async (url, init) => {
    if (String(url) === update.manifestUrl) return new Response(metadata());
    const range = new Headers(init?.headers).get('Range');
    ranges.push(range);
    assert.equal(new Headers(init?.headers).get('Accept-Encoding'), 'identity');
    return range ? partial(Number(range.match(/^bytes=(\d+)-$/)![1])) : new Response(bytes);
  };
  const options = {
    update,
    publicKey,
    destination,
    resume: true,
    signal: new AbortController().signal,
    progress: (n: number) => {
      progress.push(n);
    },
    fetch: request,
    freeSpace: async () => 10 * 1024 ** 3,
  };
  return {
    root,
    bytes,
    update,
    metadata,
    destination,
    options,
    request,
    partial,
    ranges,
    progress,
    publicKey,
  };
}

test('a connection failure saves only written bytes and the next explicit request appends the exact signed remainder', async (t) => {
  const f = await fixture(t);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await assert.rejects(
    downloadVerifiedUpdate({
      ...f.options,
      fetch: async (url) =>
        String(url) === f.update.manifestUrl
          ? new Response(f.metadata())
          : new Response(
              new ReadableStream({
                start(controller) {
                  stream = controller;
                  controller.enqueue(f.bytes.subarray(0, 80));
                },
              }),
            ),
      progress: (n) => {
        assert.equal(n, 80);
        stream.error(new TypeError('controlled disconnected socket'));
      },
    }),
    /сохранена/,
  );
  assert.deepEqual(await readFile(f.destination), f.bytes.subarray(0, 80));
  const verified = await downloadVerifiedUpdate(f.options);
  assert.equal(verified.entryCount, 2);
  assert.deepEqual(f.ranges, ['bytes=80-']);
  assert.deepEqual(f.progress, [80, f.bytes.length]);
  assert.deepEqual(await readFile(f.destination), f.bytes);
});

test('space checks preserve a saved prefix and reserve only the missing archive bytes', async (t) => {
  const f = await fixture(t);
  await writeFile(f.destination, f.bytes.subarray(0, 100));
  const required =
    f.bytes.length - 100 + f.update.manifest.archive.unpackedBytes * 2 + 128 * 1024 ** 2;
  let calls = 0;
  await assert.rejects(
    downloadVerifiedUpdate({
      ...f.options,
      freeSpace: async () => required - 1,
      fetch: async () => {
        calls++;
        throw Error('No network without space');
      },
    }),
    /места/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await readFile(f.destination), f.bytes.subarray(0, 100));
  await downloadVerifiedUpdate({ ...f.options, freeSpace: async () => required });
  assert.deepEqual(f.ranges, ['bytes=100-']);
  assert.deepEqual(await readFile(f.destination), f.bytes);
});

test('a full 200 response to Range replaces the prefix using that response once', async (t) => {
  const f = await fixture(t);
  await writeFile(f.destination, f.bytes.subarray(0, 95));
  let archives = 0;
  await downloadVerifiedUpdate({
    ...f.options,
    fetch: async (url, init) => {
      if (String(url) === f.update.manifestUrl) return new Response(f.metadata());
      archives++;
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=95-');
      return new Response(f.bytes, { headers: { 'Content-Length': String(f.bytes.length) } });
    },
  });
  assert.equal(archives, 1);
  assert.deepEqual(f.progress, [95, 0, f.bytes.length]);
  assert.deepEqual(await readFile(f.destination), f.bytes);
});

test('a rejected 416 range gets exactly one full restart, rather than an unbounded retry', async (t) => {
  const f = await fixture(t);
  await writeFile(f.destination, f.bytes.subarray(0, 90));
  const ranges: (string | null)[] = [];
  await downloadVerifiedUpdate({
    ...f.options,
    fetch: async (url, init) => {
      if (String(url) === f.update.manifestUrl) return new Response(f.metadata());
      const range = new Headers(init?.headers).get('range');
      ranges.push(range);
      return range ? new Response(null, { status: 416 }) : new Response(f.bytes);
    },
  });
  assert.deepEqual(ranges, ['bytes=90-', null]);
  assert.deepEqual(await readFile(f.destination), f.bytes);
});

for (const mode of [
  'wrong-start',
  'wrong-total',
  'wrong-end',
  'missing-range',
  'wrong-length',
  'compressed',
  'overflow',
  'corrupt-prefix',
] as const)
  test(`resumed download rejects ${mode} without accepting or retaining a corrupt archive`, async (t) => {
    const f = await fixture(t);
    const prefix = Buffer.from(f.bytes.subarray(0, 70));
    if (mode === 'corrupt-prefix') prefix[10] ^= 1;
    await writeFile(f.destination, prefix);
    await writeFile(join(f.root, 'KEEP.txt'), 'unrelated user file');
    await assert.rejects(
      downloadVerifiedUpdate({
        ...f.options,
        fetch: async (url) => {
          if (String(url) === f.update.manifestUrl) return new Response(f.metadata());
          const headers: Record<string, string> = {
            'Content-Range': `bytes 70-${f.bytes.length - 1}/${f.bytes.length}`,
          };
          if (mode === 'wrong-start')
            headers['Content-Range'] = `bytes 69-${f.bytes.length - 1}/${f.bytes.length}`;
          if (mode === 'wrong-total')
            headers['Content-Range'] = `bytes 70-${f.bytes.length - 1}/${f.bytes.length + 1}`;
          if (mode === 'wrong-end')
            headers['Content-Range'] = `bytes 70-${f.bytes.length - 2}/${f.bytes.length}`;
          if (mode === 'missing-range') delete headers['Content-Range'];
          if (mode === 'wrong-length') headers['Content-Length'] = '1';
          if (mode === 'compressed') headers['Content-Encoding'] = 'gzip';
          return new Response(mode === 'overflow' ? f.bytes : f.bytes.subarray(70), {
            status: 206,
            headers,
          });
        },
      }),
    );
    assert.deepEqual(await readdir(f.root), ['KEEP.txt']);
    assert.equal(await readFile(join(f.root, 'KEEP.txt'), 'utf8'), 'unrelated user file');
  });

test('short EOF, offline metadata and temporary HTTP errors keep a prefix; revoked or changed metadata discards it', async (t) => {
  const f = await fixture(t);
  await writeFile(f.destination, f.bytes.subarray(0, 60));
  for (const mode of [
    'offline-metadata',
    '500',
    'short-eof',
    'revoked',
    'changed',
    'signature',
  ] as const) {
    await writeFile(f.destination, f.bytes.subarray(0, 60));
    await assert.rejects(
      downloadVerifiedUpdate({
        ...f.options,
        fetch: async (url) => {
          if (String(url) === f.update.manifestUrl) {
            if (mode === 'offline-metadata') throw new TypeError('controlled offline');
            if (mode === 'revoked') return new Response(null, { status: 404 });
            if (mode === 'changed')
              return new Response(
                f.metadata({ ...f.update.manifest, sourceCommit: 'b'.repeat(40) }),
              );
            if (mode === 'signature')
              return new Response(JSON.stringify({ payload: 'bad', signature: 'bad' }));
            return new Response(f.metadata());
          }
          if (mode === '500') return new Response(null, { status: 500 });
          return new Response(f.bytes.subarray(60, 80), {
            status: 206,
            headers: { 'Content-Range': `bytes 60-${f.bytes.length - 1}/${f.bytes.length}` },
          });
        },
      }),
    );
    if (['offline-metadata', '500', 'short-eof'].includes(mode)) {
      assert.deepEqual(
        await readFile(f.destination),
        f.bytes.subarray(0, mode === 'short-eof' ? 80 : 60),
      );
    } else assert.deepEqual(await readdir(f.root), []);
  }
});

test('a complete cached archive is rehashed and revalidated without downloading again; corruption is discarded', async (t) => {
  const f = await fixture(t);
  await writeFile(f.destination, f.bytes);
  await downloadVerifiedUpdate(f.options);
  assert.deepEqual(f.ranges, []);
  assert.deepEqual(f.progress, [f.bytes.length]);
  const bad = Buffer.from(f.bytes);
  bad[30] ^= 1;
  await writeFile(f.destination, bad);
  await assert.rejects(downloadVerifiedUpdate(f.options), /сумм/);
  assert.deepEqual(await readdir(f.root), []);
});

test('closing/cancelling a resumed transfer saves its written prefix and never writes through links', async (t) => {
  const f = await fixture(t);
  const cancelled = new AbortController();
  await assert.rejects(
    downloadVerifiedUpdate({
      ...f.options,
      signal: cancelled.signal,
      progress: () => cancelled.abort(),
      fetch: async (url) =>
        String(url) === f.update.manifestUrl
          ? new Response(f.metadata())
          : new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(f.bytes.subarray(0, 50));
                },
              }),
            ),
    }),
    /abort/i,
  );
  assert.deepEqual(await readFile(f.destination), f.bytes.subarray(0, 50));
  await rm(f.destination);
  const foreign = join(f.root, 'FOREIGN');
  await writeFile(foreign, f.bytes);
  for (const type of ['symbolic', 'hard'] as const) {
    if (type === 'symbolic') await symlink(foreign, f.destination);
    else await link(foreign, f.destination);
    await assert.rejects(downloadVerifiedUpdate(f.options), /безопасно/);
    assert.deepEqual(await readFile(foreign), f.bytes);
    await rm(f.destination);
  }
});

test('one cache is reused only for the exact manifest; stale prefixes and successful downloads are removed', async (t) => {
  const f = await fixture(t);
  const cache = join(f.root, 'downloads');
  const first = await prepareDownload(cache, f.update.manifest);
  await writeFile(join(first, 'package.zip'), f.bytes.subarray(0, 100));
  await releaseDownload(first, true);
  await cleanupDownloads(cache, '0.2.0-alpha.92');
  assert.equal(await prepareDownload(cache, f.update.manifest), first);
  const changed = { ...f.update.manifest, sourceCommit: 'b'.repeat(40) };
  const replacement = await prepareDownload(cache, changed);
  assert.notEqual(replacement, first);
  assert.deepEqual(await readdir(cache), [replacement.split('/').at(-1)]);
  await releaseDownload(replacement);
  assert.deepEqual(await readdir(cache), []);
});

test('startup keeps only the newest owned pending prefix from a dead process, and removes it after that version is installed', async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((done) => child.once('exit', done));
  for (const [name, version, pid] of [
    ['download-ab1234', '0.2.0-alpha.93', child.pid],
    ['download-cd5678', '0.2.0-alpha.94', child.pid],
    ['download-ef9012', '0.2.0-alpha.93', process.pid],
  ] as const) {
    const directory = join(f.root, name);
    await mkdir(directory);
    await writeFile(
      join(directory, 'owner.json'),
      JSON.stringify({
        schema: 2,
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        pid,
        resume: { fingerprint: 'b'.repeat(64), bytes: f.bytes.length, version },
      }),
    );
    await writeFile(join(directory, 'package.zip'), f.bytes.subarray(0, 50));
    if (name === 'download-ab1234')
      await utimes(join(directory, 'owner.json'), new Date(0), new Date(0));
  }
  await cleanupDownloads(f.root, '0.2.0-alpha.92');
  assert.deepEqual((await readdir(f.root)).sort(), ['download-cd5678', 'download-ef9012']);
  await cleanupDownloads(f.root, '0.2.0-alpha.94');
  assert.deepEqual(
    await readdir(f.root),
    ['download-ef9012'],
    'Even an outdated live owner must not be deleted',
  );
});

test(
  'real HTTP disconnect survives coordinator restart and downloads only the missing bytes',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const ranges: (string | undefined)[] = [];
    let sentBytes = 0,
      prepared = 0,
      disposed = 0;
    const server = createServer((req, response) => {
      if (req.url === '/metadata') {
        response.end(f.metadata());
        return;
      }
      ranges.push(req.headers.range);
      if (ranges.length === 1) {
        response.writeHead(200, { 'Content-Length': f.bytes.length });
        response.write(f.bytes.subarray(0, 64));
        sentBytes += 64;
        setTimeout(() => response.destroy(), 100);
        return;
      }
      if (ranges.length === 2) {
        assert.equal(req.headers.range, 'bytes=64-');
        response.writeHead(206, {
          'Content-Range': `bytes 64-${f.bytes.length - 1}/${f.bytes.length}`,
          'Content-Length': f.bytes.length - 64,
        });
        response.write(f.bytes.subarray(64, 96));
        sentBytes += 32;
        setTimeout(() => response.destroy(), 100);
        return;
      }
      assert.equal(req.headers.range, 'bytes=96-');
      response.writeHead(206, {
        'Content-Range': `bytes 96-${f.bytes.length - 1}/${f.bytes.length}`,
        'Content-Length': f.bytes.length - 96,
      });
      response.end(f.bytes.subarray(96));
      sentBytes += f.bytes.length - 96;
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise<void>((done) => server.close(() => done()));
    });
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cache = join(f.root, 'cache');
    const make = () =>
      new UpdateCoordinator({
        target: { version: '0.2.0-alpha.92', platform: 'win32', arch: 'x64', osVersion: '11.0.0' },
        publicKey: f.publicKey,
        cacheRoot: cache,
        check: async () => f.update,
        download: (options) =>
          downloadVerifiedUpdate({
            ...options,
            freeSpace: f.options.freeSpace,
            fetch: (url, init) =>
              fetch(
                address + (String(url) === f.update.manifestUrl ? '/metadata' : '/archive'),
                init,
              ),
          }),
        installer: {
          prepare: async (archive) => {
            assert.deepEqual(await readFile(archive), f.bytes);
            prepared++;
            return {
              arm: async () => {
                throw Error('No installation authorized in test');
              },
              commit: async () => {
                throw Error('No commit');
              },
              dispose: async () => {
                disposed++;
              },
            };
          },
        },
        idle: () => false,
        acquire: () => undefined,
        flushMain: async () => {},
        quit: () => {
          throw Error('No quit');
        },
      });
    const first = make();
    t.after(() => first.close());
    await first.request();
    assert.equal(first.read().phase, 'error');
    assert.match(first.read().message!, /сохранена/);
    assert.equal(prepared, 0);
    await first.request();
    assert.equal(first.read().phase, 'error');
    assert.equal(first.read().downloaded, 96);
    await first.close();
    const saved = await readdir(cache);
    assert.equal(saved.length, 1);
    assert.deepEqual(await readFile(join(cache, saved[0], 'package.zip')), f.bytes.subarray(0, 96));
    const second = make();
    t.after(() => second.close());
    await second.request();
    assert.equal(second.read().phase, 'waiting');
    assert.equal(prepared, 1);
    assert.deepEqual(ranges, [undefined, 'bytes=64-', 'bytes=96-']);
    assert.equal(sentBytes, f.bytes.length);
    assert.deepEqual(await readdir(cache), []);
    await second.close();
    assert.equal(disposed, 1);
  },
);
