import test from 'node:test';
import assert from 'node:assert/strict';
import {
  githubResponse,
  readUpdateChunk,
  releaseAssetUrl,
  UpdateNetworkError,
} from '../src/main/updates/githubTransport.ts';

const address = releaseAssetUrl('v0.2.0-alpha.91', 'package.zip');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('only a validated byte range is forwarded across approved redirects, without credentials', async () => {
  let calls = 0;
  const request: typeof fetch = async (_, options) => {
    calls++;
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Range'), 'bytes=123-');
    assert.equal(headers.get('Accept-Encoding'), 'identity');
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('Cookie'), null);
    assert.equal(options?.credentials, 'omit');
    return calls === 1
      ? new Response(null, {
          status: 302,
          headers: { Location: 'https://release-assets.githubusercontent.com/owned-package' },
        })
      : new Response('range response');
  };
  const response = await githubResponse(
    address,
    new AbortController().signal,
    request,
    Date.now(),
    1000,
    123,
  );
  assert.equal(await response.text(), 'range response');
  assert.equal(calls, 2);
  await assert.rejects(
    githubResponse(address, new AbortController().signal, request, Date.now(), 1000, -1),
  );
  assert.equal(calls, 2);
});

test('header deadline ends when headers arrive, without later aborting a healthy response body', async () => {
  let requestSignal: AbortSignal | undefined;
  const response = await githubResponse(
    address,
    new AbortController().signal,
    async (_, options) => {
      requestSignal = options!.signal!;
      return new Response('still downloading');
    },
    Date.now(),
    10,
  );
  await pause(40);
  assert.equal(
    requestSignal!.aborted,
    false,
    'The old total-download deadline must not remain armed',
  );
  assert.equal(await response.text(), 'still downloading');
});

test('a stalled connection still has a bounded header deadline', async () => {
  await assert.rejects(
    githubResponse(
      address,
      new AbortController().signal,
      async (_, options) =>
        new Promise<Response>((_, reject) =>
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
            once: true,
          }),
        ),
      Date.now(),
      10,
    ),
    (error) => error instanceof UpdateNetworkError,
  );
});

test('per-read inactivity deadlines allow a continuously progressing body longer than one deadline', async () => {
  let sent = 0;
  const reader = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await pause(25);
      if (sent++ < 12) controller.enqueue(new Uint8Array([sent]));
      else controller.close();
    },
  }).getReader();
  const data: number[] = [];
  for (;;) {
    const chunk = await readUpdateChunk(reader, undefined, 250);
    if (chunk.done) break;
    data.push(...chunk.value);
  }
  reader.releaseLock();
  assert.deepEqual(
    data,
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
});

test('a stalled body is cancelled with a useful network error', async () => {
  let cancelled = false;
  const reader = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  }).getReader();
  await assert.rejects(
    readUpdateChunk(reader, undefined, 15),
    (error) => error instanceof UpdateNetworkError,
  );
  assert.equal(cancelled, true);
  reader.releaseLock();
});

test('explicit cancellation after headers aborts both the request signal and a pending read', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const response = await githubResponse(address, controller.signal, async (_, options) => {
    requestSignal = options!.signal!;
    return new Response(new ReadableStream<Uint8Array>());
  });
  const reader = response.body!.getReader();
  const read = readUpdateChunk(reader, controller.signal);
  controller.abort(Error('user cancelled update'));
  await assert.rejects(read, /user cancelled update/);
  assert.equal(requestSignal!.aborted, true);
  reader.releaseLock();
});
