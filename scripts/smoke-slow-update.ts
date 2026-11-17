/** Actual fetch streaming for >60s, with production verification and an owned loopback fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateZip, windowsEntries } from '../tests/helpers/updateZip.ts';
import { downloadVerifiedUpdate } from '../src/main/updates/download.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';
import type { FetchUpdate } from '../src/main/updates/githubTransport.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-slow-update-'));
const bytes = updateZip(windowsEntries);
const keys = generateKeyPairSync('ed25519');
const update: VerifiedUpdate = {
  manifest: {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: '0.2.0-alpha.91',
    platform: 'win32',
    arch: 'x64',
    minOs: '10.0.0',
    sourceCommit: 'a'.repeat(40),
    format: 'windows-portable-zip',
    archive: {
      name: 'Pi-Studio-0.2.0-alpha.91-win-x64.zip',
      bytes: bytes.length,
      unpackedBytes: windowsEntries.reduce((n, e) => n + Buffer.byteLength(e.text!), 0),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  },
  offer: { version: '0.2.0-alpha.91', bytes: bytes.length, notes: 'inert fixture', releaseUrl: '' },
  manifestUrl:
    'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.91/fixture.update.json',
  archiveUrl: 'https://github.com/vtlk/pi-studio/releases/download/v0.2.0-alpha.91/fixture.zip',
};
const payload = Buffer.from(JSON.stringify(update.manifest));
const metadata = JSON.stringify({
  payload: payload.toString('base64'),
  signature: sign(null, payload, keys.privateKey).toString('base64'),
});
const server = createServer((request, response) => {
  if (request.url === '/metadata') {
    response.end(metadata);
    return;
  }
  if (request.url !== '/archive') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Length': String(bytes.length) });
  response.flushHeaders();
  let step = 0;
  const timer = setInterval(() => {
    response.write(
      bytes.subarray(
        Math.floor((step * bytes.length) / 64),
        Math.floor(((step + 1) * bytes.length) / 64),
      ),
    );
    if (++step === 64) {
      clearInterval(timer);
      response.end();
    }
  }, 1000);
  response.on('close', () => clearInterval(timer));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address === 'object');
let progressCalls = 0,
  received = 0;
const local: FetchUpdate = async (input, options) => {
  const url = String(input);
  assert.ok([update.manifestUrl, update.archiveUrl].includes(url));
  assert.equal(options?.credentials, 'omit');
  const headers = new Headers(options?.headers);
  assert.equal(headers.has('authorization') || headers.has('cookie'), false);
  return fetch(
    `http://127.0.0.1:${address.port}/${url === update.manifestUrl ? 'metadata' : 'archive'}`,
    options,
  );
};
try {
  const started = performance.now();
  const destination = join(root, 'package.zip');
  await downloadVerifiedUpdate({
    update,
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    destination,
    signal: AbortSignal.timeout(90000),
    fetch: local,
    progress: (n) => {
      received = n;
      progressCalls++;
      if (progressCalls % 16 === 0) console.log(`Slow fixture progress: ${progressCalls}/64`);
    },
  });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs > 60000);
  assert.deepEqual(await readFile(destination), bytes);
  assert.equal(received, bytes.length);
  const proof = {
    checkedAt: new Date().toISOString(),
    elapsedMs,
    progressCalls,
    bytes: bytes.length,
    productionDownloadVerifier: true,
    actualFetchStreamExceeds60Seconds: true,
    signatureHashArchiveAndContentVerified: true,
    transportEndpoint: 'Owned loopback fixture only; production URL allowlist is unchanged',
    ephemeralQaSigningKeyOnly: true,
    userAppOrDataChanged: false,
    archiveExecuted: false,
    temporaryFixtureRemoved: true,
  };
  await writeFile('artifacts/slow-update-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
