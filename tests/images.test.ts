import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  rename,
  symlink,
  writeFile,
  truncate,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { SecretVault, type StringProtector } from '../src/main/storage/SecretVault.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { ImageConnections } from '../src/main/images/ImageConnections.ts';
import { ImagesApi, ImagesApiError, imageParameters } from '../src/main/images/ImagesApi.ts';
import { ImageGeneration } from '../src/main/images/ImageGeneration.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';
import { libraryPng } from '../scripts/fixtures/library.mjs';
import { readImageReferences } from '../src/main/images/imageReferences.ts';
import { crc32 } from 'node:zlib';

const KEY = 'QA_SYNTHETIC_KEY_NOT_A_REAL_CREDENTIAL';
const params = { prompt: 'Draw a blue circle', background: 'transparent' };
const model = {
  provider: 'openai-codex',
  id: 'qa-model',
  name: 'QA',
  api: 'openai-codex-responses',
  reasoning: true,
  imageInput: true,
};
function protector(): StringProtector {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptStringAsync: async (bytes) => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return {
        result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
          'utf8',
        ),
        shouldReEncrypt: false,
      };
    },
  };
}
function referenceVariant(png: Buffer) {
  const payload = Buffer.from('tEXtComment\0changed reference bytes');
  const chunk = Buffer.alloc(payload.length + 8);
  chunk.writeUInt32BE(payload.length - 4);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
const imageResponse = () =>
  Response.json({
    data: [{ b64_json: libraryPng().toString('base64') }],
    usage: { total_tokens: 4, input_tokens: 1, output_tokens: 3, key: KEY },
  });
async function fixture(t: TestContext, request: typeof fetch = async () => imageResponse()) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-images-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load(),
    crypto = protector();
  const vault = new SecretVault(join(root, 'vault'), crypto),
    api = new ImagesApi(request);
  const connections = new ImageConnections(service, vault, api);
  await store.saveSection('connections', [
    {
      id: 'images',
      name: 'QA Images',
      purpose: 'images',
      providerId: 'openai',
      endpoint: '',
      account: '',
      createdAt: 1,
    },
  ]);
  await store.saveSection('imageTool', { connectionId: 'images', modelId: 'gpt-image-2.5-flare' });
  const connection = { folder: store.folder, connectionId: 'images' };
  const agent: Agent = {
    id: 'qa-agent',
    name: 'QA images',
    enabled: true,
    mainInstruction: '',
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      connectionId: 'llm',
      provider: 'openai-codex',
      id: model.id,
      reasoning: 'Средний',
      temperature: '',
    },
  };
  const project = (await store.command({ kind: 'create', name: 'QA project', agents: [agent] }))
    .projects[0];
  const run = await buildRunContext(
    await store.projects.directory(project.id),
    project,
    agent.id,
    [agent],
    [],
  );
  run.requestSequence = 1;
  const images = new ImageGeneration(service, connections, join(root, 'operations'));
  images.bind(run, store.folder, model);
  return { root, service, store, vault, crypto, connections, connection, run, images, agent };
}

test('app secrets are ciphertext, isolated by studio/connection, survive reopen, rotate and never use plaintext fallback', async (t) => {
  const f = await fixture(t);
  await f.connections.save({ ...f.connection, key: KEY });
  const files = await readdir(join(f.root, 'vault'));
  assert.equal(files.length, 1);
  const ciphertext = await readFile(join(f.root, 'vault', files[0]), 'utf8');
  assert.equal(ciphertext.includes(KEY), false);
  const reopened = new SecretVault(join(f.root, 'vault'), f.crypto);
  assert.equal(await reopened.read(f.store.folder, 'images'), KEY);
  await mkdir(join(f.root, 'Other'));
  await assert.rejects(reopened.read(join(f.root, 'Other'), 'images'), /сохраните API-ключ/);
  await assert.rejects(reopened.read(f.store.folder, 'other'), /сохраните API-ключ/);
  await assert.rejects(reopened.read(f.store.folder, '../outside'));
  const unavailable = new SecretVault(join(f.root, 'vault'), {
    ...f.crypto,
    isAsyncEncryptionAvailable: async () => false,
  });
  await assert.rejects(
    unavailable.save(f.store.folder, 'images', 'QA_REPLACEMENT_KEY'),
    /недоступно/,
  );
  assert.equal(await readFile(join(f.root, 'vault', files[0]), 'utf8'), ciphertext);
  const state = await f.connections.status(f.connection);
  assert.equal(state.keyStored, true);
  assert.equal(state.authentication, 'unchecked');
  assert.equal(JSON.stringify(state).includes(KEY), false);
  await f.connections.save({ ...f.connection, key: 'QA_REPLACEMENT_KEY' });
  assert.equal(await reopened.read(f.store.folder, 'images'), 'QA_REPLACEMENT_KEY');
  await f.connections.remove(f.connection);
  assert.equal((await f.connections.status(f.connection)).keyStored, false);
  assert.equal(
    await readFile(join(f.store.folder, '.pistudio/studio.json'), 'utf8').then((text) =>
      text.includes(KEY),
    ),
    false,
  );
});

test('connection check only reads the fixed HTTPS model endpoint; key replacement invalidates its result', async (t) => {
  let calls = 0;
  const f = await fixture(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(init?.method, undefined);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${KEY}`);
    return Response.json({
      data: [{ id: 'gpt-image-2.5-flare' }, { id: 'gpt-6' }, { id: 'gpt-image-2.5-flare' }],
    });
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const checked = await f.connections.check(f.connection);
  assert.equal(checked.authentication, 'ready');
  assert.deepEqual(checked.modelIds, ['gpt-image-2.5-flare']);
  assert.equal(calls, 1);
  await f.connections.save({ ...f.connection, key: 'QA_REPLACEMENT_KEY' });
  assert.equal((await f.connections.status(f.connection)).authentication, 'unchecked');
  await assert.rejects(f.connections.status({ ...f.connection, folder: f.root }), /Папка студии/);
  await assert.rejects(f.connections.save({ ...f.connection, key: 'bad\nkey' }), /корректный/);
  await f.store.saveSection('connections', []);
  await assert.rejects(f.connections.key(f.connection), /отсутствует/);
});

test('only a confirmed eligible runtime exposes image tools; unknown/native/extension sessions and idle resumes spend nothing', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return imageResponse();
  });
  for (const candidate of [
    { ...model, api: undefined },
    { ...model, api: 'other-native-api' },
  ]) {
    f.images.bind(f.run, f.store.folder, candidate);
    f.images.runtime(f.run, false);
    assert.deepEqual(f.images.tools(f.run), []);
    await assert.rejects(f.images.tool(f.run, 'generate_image', params), /не подтверждены/);
  }
  f.run.resources.plugins.push({ id: 'opaque-extension', source: '/not-loaded' } as never);
  f.images.bind(f.run, f.store.folder, model);
  assert.deepEqual(f.images.tools(f.run), []);
  f.images.runtime(f.run, true);
  assert.deepEqual(f.images.tools(f.run), []);
  f.images.runtime(f.run, false);
  assert.equal(
    f.images.tools(f.run).length,
    2,
    'A resolved skill-only package does not change native capabilities.',
  );
  f.run.resources.plugins = [];
  f.images.bind(f.run, f.store.folder, model);
  assert.equal(f.images.tools(f.run).length, 2);
  f.run.requestSequence = 0;
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /нового пользовательского/);
  assert.equal(calls, 0);
});

test('generation writes one validated PNG to the bound output, keeps the agent model, and deduplicates retries within a user request', async (t) => {
  let calls = 0;
  const f = await fixture(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-image-2.5-flare');
    assert.equal(body.output_format, 'png');
    assert.equal(body.n, 1);
    assert.equal(body.background, 'transparent');
    return imageResponse();
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const before = structuredClone(f.run.record.model);
  const result = (await f.images.tool(f.run, 'generate_image', params)) as {
    operationId: string;
    path: string;
    projectPath: string;
    usage: unknown;
  };
  assert.ok(result.projectPath.startsWith(f.run.agent.outputPath + '/image-'));
  assert.ok(result.path.startsWith('image-'));
  assert.deepEqual(await readFile(join(f.run.projectRoot, result.projectPath)), libraryPng());
  assert.deepEqual(f.run.record.model, before);
  assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 3, total_tokens: 4 });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  const repeated = (await f.images.tool(f.run, 'generate_image', params)) as {
    operationId: string;
    reused: boolean;
  };
  assert.equal(repeated.operationId, result.operationId);
  assert.equal(repeated.reused, true);
  assert.equal(calls, 1);
  f.run.requestSequence++;
  const variant = (await f.images.tool(f.run, 'generate_image', params)) as { path: string };
  assert.notEqual(variant.path, result.path);
  assert.equal(calls, 2);
  const operations = await readdir(join(f.root, 'operations'));
  const metadata = await readFile(join(f.root, 'operations', operations[0]), 'utf8');
  assert.equal(metadata.includes(KEY), false);
  assert.equal(metadata.includes(params.prompt), false);
  const created = await f.store.command({
    kind: 'create',
    name: 'Other project',
    agents: [f.agent],
  });
  const other = created.projects.find((project) => project.id === created.selectedId)!;
  const otherRun = await buildRunContext(
    await f.store.projects.directory(other.id),
    other,
    f.agent.id,
    [f.agent],
    [],
  );
  f.images.bind(otherRun, f.store.folder, model);
  await assert.rejects(
    f.images.tool(otherRun, 'get_image_operation', { operationId: result.operationId }),
    /отсутствует/,
  );
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, path: '../escape' }),
    /не принимает/,
  );
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, model: 'other' }),
    /не принимает/,
  );
});

test('an uncertain paid request cannot be repeated silently, including after a new host binding', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    if (++calls === 1) throw new Error('Network lost ' + KEY);
    return imageResponse();
  });
  await f.connections.save({ ...f.connection, key: KEY });
  let operationId = '';
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), (error: Error) => {
    assert.equal(error.message.includes(KEY), false);
    assert.equal(inspect(error).includes(KEY), false);
    operationId = error.message.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)![0];
    return error.message.includes('uncertain');
  });
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /мог быть оплачен/);
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, prompt: params.prompt + ' variant' }),
    /мог быть оплачен/,
  );
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, retryOperationId: operationId }),
    /мог быть оплачен/,
  );
  const reopened = new ImageGeneration(f.service, f.connections, join(f.root, 'operations'));
  reopened.bind(f.run, f.store.folder, model);
  await assert.rejects(reopened.tool(f.run, 'generate_image', params), /мог быть оплачен/);
  assert.equal(calls, 1);
  assert.equal(
    ((await reopened.tool(f.run, 'get_image_operation', { operationId })) as { state: string })
      .state,
    'uncertain',
  );
  f.run.requestSequence++;
  await reopened.tool(f.run, 'generate_image', { ...params, retryOperationId: operationId });
  assert.equal(calls, 2);
});

test('closing Pi cancels an active image request and leaves an explicit uncertain operation', async (t) => {
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await fixture(t, async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const job = f.images.tool(f.run, 'generate_image', params);
  const check = assert.rejects(job, /uncertain/);
  await pending;
  assert.throws(() => f.images.assertIdle(), /Дождитесь/);
  f.images.cancel(f.run);
  await check;
  assert.deepEqual(f.images.tools(f.run), []);
  const files = await readdir(join(f.root, 'operations'));
  const operation = JSON.parse(await readFile(join(f.root, 'operations', files[0]), 'utf8'))
    .operations[0];
  assert.equal(operation.state, 'uncertain');
  assert.equal(operation.reason, 'cancelled');
  f.images.assertIdle();
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /Pi закрыт/);
});

test('output symlinks are rejected after the API response; an already paid result is never called a successful save', async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, async () => {
    const output = join(f.run.projectRoot, f.run.agent.outputPath);
    await rename(output, output + '-original');
    await symlink(join(f.root, 'outside'), output);
    return imageResponse();
  });
  await mkdir(join(f.root, 'outside'));
  await f.connections.save({ ...f.connection, key: KEY });
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /save_failed/);
  assert.deepEqual(await readdir(join(f.root, 'outside')), []);
});

test('API failures and invalid PNG never expose response secrets or silently change parameters', async () => {
  for (const status of [401, 403, 429, 400, 500]) {
    const api = new ImagesApi(async () =>
      Response.json({ error: { message: KEY, code: 'insufficient_quota' } }, { status }),
    );
    await assert.rejects(
      api.generate(
        KEY,
        'gpt-image-2.5-flare',
        imageParameters(params),
        new AbortController().signal,
      ),
      (error: Error) => !error.message.includes(KEY),
    );
  }
  const broken = new ImagesApi(async () =>
    Response.json({ data: [{ b64_json: Buffer.from('not a PNG ' + KEY).toString('base64') }] }),
  );
  await assert.rejects(
    broken.generate(
      KEY,
      'gpt-image-2.5-flare',
      imageParameters(params),
      new AbortController().signal,
    ),
    /не получено полностью/,
  );
  assert.throws(() => imageParameters({ ...params, quality: 'invented' }), /Неподдерживаемые/);
});

test('generation auth failures update connection health, and a stale result never labels a replacement key', async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ error: { message: KEY } }, { status: 401 }),
  );
  await f.connections.save({ ...f.connection, key: KEY });
  const old = await f.connections.authorization(f.connection);
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /ключ не принят/);
  assert.equal((await f.connections.status(f.connection)).authentication, 'invalid');
  await f.connections.save({ ...f.connection, key: 'QA_REPLACEMENT_KEY' });
  await f.connections.reportAuthorization(f.connection, old.revision, false);
  assert.equal((await f.connections.status(f.connection)).authentication, 'unchecked');
});

test('image refusals identify safe parameters and classifications without echoing provider content', async () => {
  const cases = [
    {
      status: 400,
      error: {
        code: 'unsupported_value',
        type: 'invalid_request_error',
        param: 'background',
        message: KEY,
      },
      diagnostic: {
        status: 400,
        code: 'unsupported_value',
        type: 'invalid_request_error',
        param: 'background',
      },
      text: /параметр «background»/,
    },
    {
      status: 422,
      error: { code: 'invalid_value', message: `Invalid parameter: 'image[]'. ${KEY}` },
      diagnostic: { status: 422, code: 'invalid_value', param: 'image[]' },
      text: /параметр «image\[\]»/,
    },
    {
      status: 404,
      error: { code: 'model_not_found', param: 'model', message: KEY },
      diagnostic: { status: 404, code: 'model_not_found', param: 'model' },
      text: /модель недоступна/,
    },
    {
      status: 400,
      error: { code: 'moderation_blocked', message: KEY },
      diagnostic: { status: 400, code: 'moderation_blocked' },
      text: /проверке безопасности/,
    },
    {
      status: 403,
      error: { code: 'organization_verification_required', message: KEY },
      diagnostic: { status: 403, code: 'organization_verification_required' },
      text: /верификацию организации/,
    },
    {
      status: 401,
      error: { message: `Missing scopes: api.model.request ${KEY}` },
      diagnostic: { status: 401 },
      text: /api.model.request/,
    },
    {
      status: 400,
      error: { code: KEY, type: KEY, param: KEY, message: `Invalid parameter: '${KEY}'.` },
      diagnostic: { status: 400 },
      text: /не указал распознанный параметр/,
    },
  ];
  for (const item of cases) {
    let calls = 0;
    const api = new ImagesApi(async () => {
      calls++;
      return Response.json({ error: item.error }, { status: item.status });
    });
    await assert.rejects(
      api.generate(KEY, 'gpt-image-2', imageParameters(params), new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ImagesApiError);
        assert.match(error.message, item.text);
        assert.match(error.message, new RegExp(`HTTP ${item.status}`));
        assert.deepEqual(error.diagnostic, item.diagnostic);
        assert.ok(!inspect(error).includes(KEY));
        return true;
      },
    );
    assert.equal(calls, 1, 'a refusal must never retry');
  }
});

test('failed image diagnostics remain readable in the exact agent scope without another API request', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return Response.json(
      {
        error: {
          code: 'unsupported_value',
          param: 'background',
          message: KEY,
          type: 'invalid_request_error',
        },
      },
      { status: 400 },
    );
  });
  await f.connections.save({ ...f.connection, key: KEY });
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /param=background/);
  const file = (await readdir(join(f.root, 'operations')))[0];
  const json = await readFile(join(f.root, 'operations', file), 'utf8');
  assert.ok(!json.includes(KEY));
  assert.ok(!json.includes(params.prompt));
  const saved = JSON.parse(json).operations[0];
  const operation = await f.images.tool(f.run, 'get_image_operation', { operationId: saved.id });
  assert.deepEqual(operation, saved);
  assert.equal(saved.state, 'failed');
  assert.equal(saved.reason, 'parameters');
  assert.deepEqual(saved.diagnostic, {
    status: 400,
    code: 'unsupported_value',
    param: 'background',
    type: 'invalid_request_error',
  });
  assert.equal(calls, 1);
});

test('catalog permission refusals distinguish restricted access from invalid keys without echoing provider text', async () => {
  const cases = [
    {
      body: { error: `Missing scopes: api.model.read. ${KEY}` },
      status: 403,
      kind: 'access',
      text: /List models → Read/,
    },
    {
      body: { error: { message: `Missing scopes: api.model.read. ${KEY}` } },
      status: 401,
      kind: 'access',
      text: /api.model.read/,
    },
    {
      body: { error: { code: 'invalid_api_key', message: KEY } },
      status: 401,
      kind: 'authentication',
      text: /ключ не принят/,
    },
    {
      body: { error: { code: 'unsupported_country_region_territory', message: KEY } },
      status: 403,
      kind: 'access',
      text: /страны или региона/,
    },
    { body: { error: { message: KEY } }, status: 403, kind: 'access', text: /HTTP 403/ },
    { body: null, status: 403, kind: 'access', text: /HTTP 403/ },
  ];
  for (const item of cases) {
    let calls = 0;
    const api = new ImagesApi(async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.notEqual(options?.method, 'POST');
      return Response.json(item.body, { status: item.status });
    });
    await assert.rejects(api.models(KEY), (error: Error & { kind?: string }) => {
      assert.equal(error.kind, item.kind);
      assert.match(error.message, item.text);
      assert.ok(!inspect(error).includes(KEY));
      return true;
    });
    assert.equal(calls, 1);
  }
  for (const body of ['<html>forbidden ' + KEY + '</html>', 'x'.repeat(20000) + KEY]) {
    const api = new ImagesApi(async () => new Response(body, { status: 403 }));
    await assert.rejects(
      api.models(KEY),
      (error: Error & { kind?: string }) =>
        error.kind === 'access' && !inspect(error).includes(KEY),
    );
  }
});

test('a missing models-read permission keeps the key stored and reports restricted access', async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      {
        error: `Insufficient permissions. Missing scopes: api.model.read. ${KEY}`,
      },
      { status: 403 },
    ),
  );
  await f.connections.save({ ...f.connection, key: KEY });
  await assert.rejects(f.connections.check(f.connection), /List models → Read/);
  const state = await f.connections.status(f.connection);
  assert.equal(state.authentication, 'restricted');
  assert.equal(state.keyStored, true);
  assert.deepEqual(state.modelIds, []);
  assert.ok(!JSON.stringify(state).includes(KEY));
  await assert.rejects(f.images.tool(f.run, 'generate_image', params), /api.model.read/);
  assert.equal((await f.connections.status(f.connection)).authentication, 'restricted');
});

test('a stale catalog refusal cannot overwrite a replacement key successful check', async (t) => {
  let refuse!: (response: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const f = await fixture(t, async () => {
    if (++calls === 1) {
      started();
      return new Promise<Response>((resolve) => {
        refuse = resolve;
      });
    }
    return Response.json({ data: [{ id: 'gpt-image-2' }] });
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const stale = f.connections.check(f.connection);
  await entered;
  await f.connections.save({ ...f.connection, key: 'QA_REPLACEMENT_KEY' });
  await f.connections.check(f.connection);
  refuse(Response.json({ error: 'Missing scopes: api.model.read' }, { status: 403 }));
  await assert.rejects(stale, /Ключ изменился/);
  assert.equal((await f.connections.status(f.connection)).authentication, 'ready');
});

test('reference images use the edits multipart endpoint with exact ordered project bytes and no source mutation', async (t) => {
  let calls = 0;
  const png = libraryPng();
  const f = await fixture(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(
      new Headers(init?.headers).has('Content-Type'),
      false,
      'Native FormData supplies its boundary',
    );
    const wire = new Request(String(url), init);
    assert.match(wire.headers.get('Content-Type')!, /^multipart\/form-data; boundary=/);
    const form = await wire.formData();
    assert.equal(form.get('model'), 'gpt-image-2.5-flare');
    assert.equal(form.get('prompt'), params.prompt);
    assert.equal(form.get('n'), '1');
    assert.equal(form.get('output_format'), 'png');
    assert.equal(form.get('background'), 'transparent');
    const files = form.getAll('image[]') as File[];
    assert.equal(files.length, 2);
    for (const [index, file] of files.entries()) {
      assert.equal(file.type, 'image/png');
      assert.equal(file.name, `reference-${index + 1}.png`);
      assert.deepEqual(
        Buffer.from(await file.arrayBuffer()),
        index === 0 ? png : referenceVariant(png),
      );
    }
    return imageResponse();
  });
  await f.connections.save({ ...f.connection, key: KEY });
  await mkdir(join(f.run.projectRoot, 'references'));
  const references = ['references/лицо с пробелом.png', `${f.run.agent.outputPath}/prior.png`];
  for (const [index, path] of references.entries())
    await writeFile(join(f.run.projectRoot, path), index === 0 ? png : referenceVariant(png));
  const result = await f.images.tool(f.run, 'generate_image', { ...params, references });
  assert.equal(calls, 1);
  assert.equal(
    (await f.images.tool(f.run, 'generate_image', { ...params, references })).operationId,
    result.operationId,
  );
  assert.equal(calls, 1, 'An identical call in the same request reuses its result');
  for (const [index, path] of references.entries())
    assert.deepEqual(
      await readFile(join(f.run.projectRoot, path)),
      index === 0 ? png : referenceVariant(png),
    );
  const meta = await readFile(
    join(f.root, 'operations', (await readdir(join(f.root, 'operations')))[0]),
    'utf8',
  );
  const operation = JSON.parse(meta).operations[0];
  assert.equal(operation.referenceHashes.length, 2);
  assert.ok(operation.referenceHashes.every((value: string) => /^[a-f0-9]{64}$/.test(value)));
  assert.ok(
    !meta.includes('лицо') &&
      !meta.includes(png.toString('base64')) &&
      !meta.includes(params.prompt) &&
      !meta.includes(KEY),
  );
});

test('reference content changes invalidate reuse and a text-only call retains its original endpoint', async (t) => {
  const endpoints: string[] = [];
  const f = await fixture(t, async (url) => {
    endpoints.push(String(url));
    return imageResponse();
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const path = `${f.run.agent.outputPath}/reference.png`;
  const png = libraryPng();
  await writeFile(join(f.run.projectRoot, path), png);
  const first = await f.images.tool(f.run, 'generate_image', { ...params, references: [path] });
  await writeFile(join(f.run.projectRoot, path), referenceVariant(png));
  const second = await f.images.tool(f.run, 'generate_image', { ...params, references: [path] });
  assert.notEqual(second.operationId, first.operationId);
  await f.images.tool(f.run, 'generate_image', { ...params, references: [] });
  assert.deepEqual(endpoints, [
    'https://api.openai.com/v1/images/edits',
    'https://api.openai.com/v1/images/edits',
    'https://api.openai.com/v1/images/generations',
  ]);
});

test('invalid, oversized or out-of-project references are rejected before any API request', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return imageResponse();
  });
  await f.connections.save({ ...f.connection, key: KEY });
  await writeFile(join(f.root, 'outside.png'), libraryPng());
  await symlink(join(f.root, 'outside.png'), join(f.run.projectRoot, 'linked.png'));
  await writeFile(join(f.run.projectRoot, 'not-image.png'), 'plain text');
  await writeFile(join(f.run.projectRoot, 'empty.png'), '');
  await writeFile(join(f.run.projectRoot, 'oversized.jpg'), '');
  await truncate(join(f.run.projectRoot, 'oversized.jpg'), 32 * 1024 ** 2 + 1);
  const invalid = [
    null,
    'file.png',
    ['../outside.png'],
    [join(f.root, 'outside.png')],
    ['https://example.com/image.png'],
    ['data:image/png;base64,abcd'],
    ['linked.png'],
    ['not-image.png'],
    ['empty.png'],
    ['oversized.jpg'],
    ['missing.png'],
    ['a.png', 'a.png'],
    Array.from({ length: 17 }, (_, i) => `${i}.png`),
  ];
  for (const references of invalid)
    await assert.rejects(f.images.tool(f.run, 'generate_image', { ...params, references }));
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(join(f.root, 'operations')).catch(() => []), []);
  for (let index = 0; index < 3; index++) {
    await writeFile(join(f.run.projectRoot, `${index}.jpg`), Buffer.from([255, 216, 255, 224]));
    await truncate(join(f.run.projectRoot, `${index}.jpg`), 24 * 1024 ** 2);
  }
  await assert.rejects(
    readImageReferences(f.run.projectRoot, ['0.jpg', '1.jpg', '2.jpg']),
    /64 МБ/,
  );
});

test('a refused reference edit never falls back to a text generation request', async (t) => {
  let calls = 0;
  const f = await fixture(t, async (url) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    return Response.json(
      { error: { message: 'unsupported reference operation ' + KEY } },
      { status: 400 },
    );
  });
  await f.connections.save({ ...f.connection, key: KEY });
  const path = `${f.run.agent.outputPath}/ref.png`;
  await writeFile(join(f.run.projectRoot, path), libraryPng());
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, references: [path] }),
    /Автоматической подмены нет/,
  );
  await assert.rejects(
    f.images.tool(f.run, 'generate_image', { ...params, references: [path] }),
    /отклонена API/,
  );
  assert.equal(calls, 1);
});
