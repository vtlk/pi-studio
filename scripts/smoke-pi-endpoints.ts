import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { BrowserAuth, resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { ModelConnections } from '../src/main/pi/ModelConnections.ts';
import { connectionAuthScope } from '../src/main/pi/modelAuth.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { Agent } from '../src/shared/studio.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-endpoints-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
assert.equal(pi.supported, true);
const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
const { createConnectionRuntime } = await import('../bundled/pi-bridge/connection-runtime.mjs');
const scripts = new URL('../bundled/pi-bridge/', import.meta.url).pathname;
const key = 'sk-endpoint-fixture-never-real';
const requests: { url: string; authorization?: string; body?: Record<string, unknown> }[] = [];
let listMode: 'normal' | 'error' | 'redirect' = 'normal';
let quotaError = false;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
  requests.push({ url: req.url!, authorization: req.headers.authorization, body });
  const keyed = req.url?.startsWith('/key/');
  if (req.headers.authorization !== (keyed ? `Bearer ${key}` : undefined)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: { message: 'Wrong fixture auth' } }));
    return;
  }
  if (req.url?.endsWith('/models')) {
    if (listMode === 'error') {
      res.writeHead(403);
      res.end(JSON.stringify({ error: key }));
      return;
    }
    if (listMode === 'redirect') {
      res.writeHead(302, { Location: '/redirect-target' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'qa-chat' }, { id: 'qa-chat' }, { id: 'qa-other' }] }));
    return;
  }
  if (quotaError) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'The usage limit has been reached. PRIVATE_PROVIDER_DETAIL',
          type: 'invalid_request_error',
        },
      }),
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
  if (req.url?.endsWith('/chat/completions')) {
    event({
      id: 'qa-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qa-chat',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'QA endpoint response' },
          finish_reason: null,
        },
      ],
    });
    event({
      id: 'qa-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qa-chat',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    res.end('data: [DONE]\n\n');
    return;
  }
  const item = {
    id: 'qa-message',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'QA endpoint response', annotations: [] }],
  };
  event({
    type: 'response.created',
    response: { id: 'qa-response', object: 'response', status: 'in_progress', output: [] },
  });
  event({
    type: 'response.output_item.added',
    output_index: 0,
    item: { ...item, status: 'in_progress', content: [] },
  });
  event({
    type: 'response.content_part.added',
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  event({
    type: 'response.output_text.delta',
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: 'QA endpoint response',
  });
  event({ type: 'response.output_item.done', output_index: 0, item });
  event({
    type: 'response.completed',
    response: {
      id: 'qa-response',
      object: 'response',
      status: 'completed',
      output: [item],
      model: 'qa-chat',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const auth = new BrowserAuth(join(scripts, 'login.mjs'), async () => {
  throw new Error('No external browser in endpoint test');
});
const connections = new ModelConnections(
  service,
  join(root, 'model-auth'),
  scripts,
  () => pi.path,
  auth,
);
const profiles: Connection[] = ['key', 'none'].map((id) => ({
  id,
  providerId: endpointProviderId(id),
  name: id,
  purpose: id === 'key' ? 'compatible' : 'local',
  authScope: 'connection',
  endpoint: `http://127.0.0.1:${port}/${id}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions',
    auth: id === 'key' ? 'api_key' : 'none',
    models: [
      {
        id: 'qa-chat',
        name: 'QA chat',
        imageInput: false,
        reasoning: false,
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  },
}));
const request = (id: string) => ({ folder: store.folder, connectionId: id });
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Endpoint login timeout');
};
const previousEnv = process.env.OPENAI_API_KEY;
try {
  process.env.OPENAI_API_KEY = 'sk-ambient-must-not-be-sent';
  await store.saveSection('connections', profiles);
  assert.equal((await connections.status(request('key'))).status, 'not_ready');
  assert.equal((await connections.status(request('none'))).status, 'ready');
  const login = await connections.login({ ...request('key'), method: 'api_key' });
  await until(() => !!auth.read(login.id).prompt);
  auth.answer(login.id, auth.read(login.id).prompt!.id, key);
  await until(() => ['ready', 'error'].includes(auth.read(login.id).phase));
  assert.equal(auth.read(login.id).phase, 'ready');
  for (const connection of profiles) {
    assert.deepEqual(await connections.discover(request(connection.id)), ['qa-chat', 'qa-other']);
    const catalog = await connections.catalog(request(connection.id));
    assert.deepEqual(
      catalog.models
        .filter((model) => model.provider === connection.providerId)
        .map((model) => model.id),
      ['qa-chat'],
    );
    assert.equal(
      catalog.providers
        .find((provider) => provider.id === connection.providerId)!
        .loginMethods?.some((method) => method.id === 'oauth'),
      false,
    );
    for (const api of ['openai-completions', 'openai-responses'] as const) {
      const configured = { ...connection, endpointConfig: { ...connection.endpointConfig!, api } };
      const runtime = await createConnectionRuntime(
        sdk,
        await connectionAuthScope(join(root, 'model-auth'), store.folder, configured),
      );
      // Protocol changes intentionally use a fresh auth namespace; login fixture credentials via native SDK.
      if (connection.endpointConfig!.auth === 'api_key' && api === 'openai-responses') {
        await runtime.login(connection.providerId, 'api_key', {
          prompt: async () => key,
          notify() {},
        });
        await runtime.settleCredentialWrites();
      }
      const model = runtime.getModel(connection.providerId, 'qa-chat');
      const result = await runtime.completeSimple(model, {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Fixture request' }],
            timestamp: Date.now(),
          },
        ],
      });
      assert.equal(result.stopReason, 'stop');
      assert.equal(
        result.content
          .filter((part: { type: string }) => part.type === 'text')
          .map((part: { text: string }) => part.text)
          .join(''),
        'QA endpoint response',
      );
      assert.equal(requests.at(-1)!.body!.model, 'qa-chat');
      assert.equal(
        requests.at(-1)!.authorization,
        connection.id === 'key' ? `Bearer ${key}` : undefined,
      );
    }
  }
  const beforeError = await readFile(join(store.folder, '.pistudio/studio.json'), 'utf8');
  for (const mode of ['error', 'redirect'] as const) {
    listMode = mode;
    const count = requests.length;
    await assert.rejects(
      () => connections.discover(request('key')),
      (error: Error) =>
        error.message.includes('добавьте ID модели вручную') && !error.message.includes(key),
    );
    assert.equal(requests.length, count + 1, 'Discovery must not follow redirects or retry');
    assert.equal(await readFile(join(store.folder, '.pistudio/studio.json'), 'utf8'), beforeError);
  }
  listMode = 'normal';
  const moved = { ...profiles[0], endpoint: `http://127.0.0.1:${port}/changed/v1` };
  const movedScope = await connectionAuthScope(join(root, 'model-auth'), store.folder, moved);
  const movedRuntime = await createConnectionRuntime(sdk, movedScope);
  assert.equal(
    await movedRuntime.getAuth(moved.providerId),
    undefined,
    'A changed destination cannot reuse the old key',
  );
  const profile: Agent = {
    id: 'qa-endpoint-agent',
    name: 'Endpoint agent',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction: 'Reply to the user.',
    model: {
      connectionId: 'none',
      provider: profiles[1].providerId,
      id: 'qa-chat',
      reasoning: 'По умолчанию',
      temperature: '',
    },
  };
  await store.saveSection('agents', [profile]);
  const project = (
    await store.command({ kind: 'create', name: 'Endpoint project', agents: [profile] })
  ).projects[0];
  const children: Promise<number | null>[] = [];
  const failures: (string | undefined)[] = [];
  const host = createStudioRunHost(service, {
    failureChanged: (_run, failure) => {
      failures.push(failure);
    },
    bootstraps: join(root, 'boots'),
    bridge: join(scripts, 'session.mjs'),
    catalog: join(scripts, 'catalog.mjs'),
    piPath: () => pi.path,
    headless: true,
    openTerminal: async (node, bridge, bootstrap) => {
      const child = spawn(node, [bridge, bootstrap], {
        stdio: 'ignore',
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      });
      children.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
  });
  try {
    await host.launch({
      projectId: project.id,
      agentId: profile.id,
      firstMessage: 'Reply once without tools.',
      autoContinue: false,
    });
    assert.equal(await children[0], 0);
    const saved = await store.projects.read(project.id);
    assert.equal(
      saved.agents[0].runStatus,
      'stopped',
      'A response alone is not validated stage completion',
    );
    const transcript = await readFile(
      join(await store.projects.directory(project.id), saved.agents[0].session!.path),
      'utf8',
    );
    assert.ok(transcript.includes('QA endpoint response'));
    assert.equal(transcript.includes(key), false);
    const count = requests.filter((item) => item.body).length;
    await host.launch({ projectId: project.id, agentId: profile.id, autoContinue: false });
    assert.equal(await children[1], 0);
    assert.equal(
      requests.filter((item) => item.body).length,
      count,
      'Idle resume sends no second request',
    );
    const next = { ...profile, id: 'qa-next-agent', name: 'Next agent' };
    await store.saveSection('agents', [profile, next]);
    const quotaProject = (
      await store.command({ kind: 'create', name: 'Quota check', agents: [profile, next] })
    ).projects[0];
    quotaError = true;
    const beforeQuotaRequests = requests.filter((item) => item.body).length;
    const failedRun = await host.launch({
      projectId: quotaProject.id,
      agentId: profile.id,
      firstMessage: 'Fixture quota request',
      autoContinue: true,
    });
    assert.equal(await children.at(-1), 0);
    const stopped = await store.projects.read(quotaProject.id);
    assert.equal(stopped.agents[0].runStatus, 'error');
    assert.equal(stopped.agents[0].runFailure, 'usage_limit');
    assert.equal(stopped.agents[1].session, undefined);
    assert.equal(requests.filter((item) => item.body).length, beforeQuotaRequests + 1);
    assert.equal(failures.at(-1), 'usage_limit');
    const failureRecord = await readFile(
      join(
        await store.projects.directory(quotaProject.id),
        '.pistudio/context',
        failedRun.runId,
        'result.json',
      ),
      'utf8',
    );
    assert.equal(JSON.parse(failureRecord).failure, 'usage_limit');
    assert.equal(failureRecord.includes('PRIVATE_PROVIDER_DETAIL'), false);
    assert.equal(JSON.stringify(failures).includes('PRIVATE_PROVIDER_DETAIL'), false);
  } finally {
    host.close();
    await Promise.allSettled(children);
  }
  assert.equal(
    (await readFile(join(store.folder, '.pistudio/studio.json'), 'utf8')).includes(key),
    false,
  );
  for (const request of requests.filter((item) => item.body)) {
    assert.equal(
      request.body!.reasoning,
      undefined,
      'Non-reasoning model sends no Responses reasoning parameter',
    );
    assert.equal(
      request.body!.reasoning_effort,
      undefined,
      'Non-reasoning model sends no Chat reasoning_effort parameter',
    );
  }
  console.log(
    'Native endpoints passed: keyed/keyless discovery, both OpenAI protocols through real SDK, actual URL/model/auth, no ambient fallback or key reuse after destination change, production launch and exact idle resume; non-reasoning models send no reasoning/effort parameters. All HTTP stayed on local fixture.',
  );
} finally {
  auth.close();
  if (previousEnv === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousEnv;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
