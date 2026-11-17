/** Real HTTP streams across the old three-minute failure boundary; never starts a browser. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadBrowserComponent } from '../src/main/browser/componentFiles.ts';
import { installChrome } from '../src/main/browser/installChrome.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-slow-browser-'));
const bytes = Buffer.alloc(190, 42);
const server = createServer((request, response) => {
  if (request.url === '/headers') return;
  response.writeHead(200, { 'Content-Length': bytes.length });
  response.flushHeaders();
  if (request.url === '/stall') return;
  let offset = 0;
  const timer = setInterval(() => {
    response.write(bytes.subarray(offset, ++offset));
    if (offset === bytes.length) {
      clearInterval(timer);
      response.end();
    }
  }, 1000);
  response.once('close', () => clearInterval(timer));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const expected = {
  algorithm: 'sha256',
  encoding: 'hex',
  hash: createHash('sha256').update(bytes).digest('hex'),
  maxBytes: bytes.length,
} as const;
const start = Date.now();
try {
  const results = await Promise.allSettled([
    (async () => {
      await downloadBrowserComponent(
        url,
        join(root, 'verified'),
        new AbortController().signal,
        expected,
      );
      assert.deepEqual(await readFile(join(root, 'verified')), bytes);
      assert.ok(Date.now() - start > 180_000);
      return { progressiveDownloadMs: Date.now() - start, sha256Verified: true };
    })(),
    ...['stall', 'headers'].map(async (route) => {
      const before = Date.now();
      // Exercise actual installer failure cleanup; failure occurs before extraction/--version.
      await assert.rejects(
        installChrome(join(root, route, 'browser'), new AbortController().signal, {
          headed: true,
          request: (_, options) => fetch(url + '/' + route, options),
        }),
        route === 'stall' ? /not sent download data|не передаёт/ : /did not respond|не ответил/,
      );
      assert.deepEqual(await readdir(join(root, route)), []);
      return { route, failedAfterMs: Date.now() - before, ownedStageRemoved: true };
    }),
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const proof = {
    checkedAt: new Date().toISOString(),
    checks: results.map((result) => (result.status === 'fulfilled' ? result.value : null)),
    browserOrInstalledAppStarted: false,
    userDataChanged: false,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/browser-timeouts-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
