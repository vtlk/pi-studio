import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { VoiceModels } from '../src/main/voice/VoiceModels.ts';
const data = Buffer.from('hash-pinned model fixture');
const file = {
  name: 'onnx/model.onnx',
  bytes: data.length,
  sha256: createHash('sha256').update(data).digest('hex'),
};
const manifest = { repo: 'qa/model', revision: 'pinned', dtype: 'q4', files: [file] };
test('voice model cache verifies every download, persists across instances and serves only pinned model files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-model-'));
  try {
    let calls = 0;
    const fetcher: typeof fetch = async (url) => {
      calls++;
      assert.equal(String(url), 'https://huggingface.co/qa/model/resolve/pinned/onnx/model.onnx');
      return new Response(data);
    };
    const model = new VoiceModels(root, fetcher, manifest);
    await model.prepare();
    assert.equal(model.read().phase, 'ready');
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(join(root, file.name)), data);
    const next = new VoiceModels(
      root,
      async () => {
        throw Error('must reuse cache');
      },
      manifest,
    );
    const cached = next.prepare();
    assert.equal(
      next.read().phase,
      'checking',
      'Hash verification must not be labelled as a download',
    );
    await cached;
    assert.equal(next.read().phase, 'ready');
    const response = await next.response(
      new Request('studio-voice://models/qa/model/onnx/model.onnx'),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
    assert.equal(
      (await next.response(new Request('studio-voice://models/qa/model/../../workspace.json')))
        .status,
      404,
    );
    assert.equal(
      (await next.response(new Request('studio-voice://wrong/qa/model/onnx/model.onnx'))).status,
      404,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('model hash failures and cancelled transfers leave no accepted or partial model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-model-error-'));
  try {
    const broken = new VoiceModels(
      root,
      async () => new Response(Buffer.alloc(data.length)),
      manifest,
    );
    await assert.rejects(broken.prepare());
    assert.equal(broken.read().phase, 'error');
    assert.deepEqual(await readdir(join(root, 'onnx')), []);
    let started!: () => void;
    const reading = new Promise<void>((done) => {
      started = done;
    });
    const cancel = new VoiceModels(
      root,
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(data.subarray(0, 3));
              options?.signal?.addEventListener('abort', () =>
                controller.error(new Error('cancelled')),
              );
              started();
            },
          }),
        ),
      manifest,
    );
    const result = assert.rejects(cancel.prepare());
    await reading;
    await cancel.close();
    await result;
    assert.equal(cancel.read().phase, 'idle');
    assert.deepEqual(await readdir(join(root, 'onnx')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
