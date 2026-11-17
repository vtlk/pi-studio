import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestTransfer, readTransferChunk } from '../src/main/network/transfer.ts';
import { downloadBrowserComponent } from '../src/main/browser/componentFiles.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import { RunChannel } from '../src/main/pi/RunChannel.ts';
import { runtimeCommand } from '../src/main/pi/installRuntime.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('long internal MCP calls send SSE headers before completion and return one final success/error', async (t) => {
  const channel = new RunChannel();
  t.after(() => channel.close());
  for (const name of ['generate_image', 'install_package']) {
    for (const failure of [false, true]) {
      let finish!: () => void;
      let calls = 0;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const lease = await channel.add(
        'long-tool',
        { resources: { mcpServers: [] } } as never,
        async () => {},
        async () => {
          calls++;
          await gate;
          if (failure) throw Error('operation failed');
          return { completed: true };
        },
        [{ name, description: 'fixture', inputSchema: { type: 'object' } }],
      );
      const response = await fetch(lease.url + '/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lease.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }),
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
      const reader = response.body!.getReader();
      const initial = await reader.read();
      assert.match(Buffer.from(initial.value!).toString(), /^: waiting/);
      assert.equal(calls, 1);
      finish();
      let body = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += Buffer.from(chunk.value).toString();
      }
      const data = JSON.parse(body.match(/data: (.+)/)![1]);
      assert.equal(data.result.isError === true, failure);
      assert.equal(calls, 1);
      reader.releaseLock();
      channel.remove('long-tool');
    }
  }
});

test('a timed-out installer child is gone before its caller may remove staging', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-install-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidFile = join(root, 'pid');
  await assert.rejects(
    runtimeCommand(
      process.execPath,
      [
        '-e',
        'require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',
        pidFile,
      ],
      new AbortController().signal,
      { timeout: 500 },
    ),
    /время|срок|Timed|time|долго/i,
  );
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('header timeout ends after headers; caller cancellation remains connected to the body', async () => {
  const controller = new AbortController();
  let transportSignal!: AbortSignal;
  const response = await requestTransfer(
    'https://fixture',
    { signal: controller.signal },
    async (_, options) => {
      transportSignal = options!.signal!;
      return new Response('body');
    },
    10,
  );
  await pause(40);
  assert.equal(transportSignal.aborted, false);
  controller.abort(new Error('cancelled'));
  assert.equal(transportSignal.aborted, true);
  assert.equal(await response.text(), 'body');
});

test('missing headers fail even for an adapter ignoring AbortSignal; a late body is cancelled', async () => {
  let release!: (value: Response) => void;
  let cancelled = false;
  await assert.rejects(
    requestTransfer(
      'https://fixture',
      {},
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      10,
    ),
    /60 секунд/,
  );
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await pause(10);
  assert.equal(cancelled, true);
});

test('streaming progresses beyond one idle window; empty chunks cannot keep a stall alive', async () => {
  let sent = 0;
  const reader = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await pause(20);
      if (++sent <= 8) controller.enqueue(new Uint8Array([sent]));
      else controller.close();
    },
  }).getReader();
  const bytes: number[] = [];
  for (;;) {
    const chunk = await readTransferChunk(reader, undefined, 100);
    if (chunk.done) break;
    bytes.push(...chunk.value);
  }
  assert.deepEqual(bytes, [1, 2, 3, 4, 5, 6, 7, 8]);
  reader.releaseLock();
  let cancelled = false;
  const empty = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await pause(5);
      if (!cancelled) controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
    },
  }).getReader();
  await assert.rejects(readTransferChunk(empty, undefined, 40), /не передаёт/);
  assert.equal(cancelled, true);
  empty.releaseLock();
});

test('idle timeout and explicit cancellation cancel pending reads, with translated RU/EN errors', async () => {
  for (const locale of ['ru', 'en'] as const) {
    await changeLanguage(locale);
    const idle = new ReadableStream<Uint8Array>().getReader();
    await assert.rejects(
      readTransferChunk(idle, undefined, 10),
      locale === 'ru' ? /Сервер не передаёт/ : /server has not sent/,
    );
    idle.releaseLock();
    await assert.rejects(
      requestTransfer('https://fixture', {}, () => new Promise(() => {}), 10),
      locale === 'ru' ? /Сервер загрузки/ : /download server/,
    );
  }
  await changeLanguage('ru');
  let cancelled = false;
  const reader = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  }).getReader();
  const controller = new AbortController();
  const reading = readTransferChunk(reader, controller.signal);
  controller.abort(new Error('explicit cancellation'));
  await assert.rejects(reading, /explicit cancellation/);
  assert.equal(cancelled, true);
  reader.releaseLock();
});

test('browser downloader verifies a real HTTP stream and cancels a stalled socket without publishing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-transfer-'));
  const bytes = Buffer.from('pinned browser fixture');
  const server = createServer((request, response) => {
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
    }, 5);
    response.once('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const expected = {
    algorithm: 'sha256',
    encoding: 'hex',
    hash: createHash('sha256').update(bytes).digest('hex'),
    maxBytes: bytes.length,
  } as const;
  await downloadBrowserComponent(url, join(root, 'ok'), new AbortController().signal, expected);
  assert.deepEqual(await readFile(join(root, 'ok')), bytes);
  const controller = new AbortController();
  const stalled = downloadBrowserComponent(
    url + '/stall',
    join(root, 'partial'),
    controller.signal,
    expected,
  );
  setTimeout(() => controller.abort(new Error('cancel stalled download')), 40);
  await assert.rejects(stalled, /cancel stalled download/);
  assert.equal((await readFile(join(root, 'partial'))).length, 0);
});
