import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { ImageGeneration } from '../src/main/images/ImageGeneration.ts';
import { ImageConnections } from '../src/main/images/ImageConnections.ts';
import { ImagesApi } from '../src/main/images/ImagesApi.ts';
import { SecretVault } from '../src/main/storage/SecretVault.ts';
import { confirmedChatAdapter } from '../src/main/images/imageRuntime.ts';
import { qaToolScope } from './qa-tool-scope.ts';
import { libraryPng } from './fixtures/library.mjs';
import type { Agent } from '../src/shared/studio.ts';
import type { Connection } from '../src/shared/connections.ts';

// Actual Pi SDK / bridge / production MCP, with a local OpenAI-compatible SSE fixture.
// No cloud LLM request, paid Images request, real Keychain or user studio access.
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-native-image-capabilities-')));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
assert.equal(pi.version, '1.5.2');
const sdkPath = await resolvePiSdk(await realpath(pi.path));
const types = await readFile(
  join(dirname(sdkPath), '../node_modules/@earendil-works/pi-ai/dist/types.d.ts'),
  'utf8',
);
const nativeApis = [
  ...types.match(/export type KnownApi = ([\s\S]*?);/)![1].matchAll(/"([^"]+)"/g),
].map((match) => match[1]);
const assistantContent = types.match(
  /export interface AssistantMessage \{[\s\S]*?content: ([^\n]+);/,
)![1];
assert.equal(assistantContent, '(TextContent | ThinkingContent | ToolCall)[]');
const agentSdk = await readFile(join(dirname(sdkPath), 'core/sdk.js'), 'utf8');
assert.ok(agentSdk.includes('return modelRuntime.streamSimple(model, context, requestOptions);'));
const bridge = await readFile('bundled/pi-bridge/session.mjs', 'utf8');
assert.ok(bridge.includes('createCodemodeExtension({ models: false })'));
assert.equal(bridge.includes('generateImages'), false);
assert.ok(
  types.includes('Image-generation model: usable with') && types.includes('generateImages()'),
);
const candidate = {
  provider: 'qa',
  id: 'qa-chat',
  name: 'QA',
  reasoning: false,
  imageInput: false,
};
for (const api of nativeApis) assert.equal(confirmedChatAdapter({ ...candidate, api }), true, api);
assert.equal(confirmedChatAdapter({ ...candidate, api: 'openrouter-images' }), false);
assert.equal(confirmedChatAdapter({ ...candidate, api: 'future-unknown-api' }), false);
assert.equal(confirmedChatAdapter(candidate), false);

let phase = 0,
  mode: 'eligible' | 'gated' = 'eligible',
  failure: unknown,
  imagesCalls = 0;
const observed: Record<string, { calls: number; toolNames: string[]; availability?: unknown }> = {};
const toolName = (name: string) => 'mcp__pi_studio__' + name;
function resultText(body: any) {
  const content = body.messages.filter((message: any) => message.role === 'tool').at(-1)?.content;
  return typeof content === 'string'
    ? content
    : (content ?? []).map((part: any) => part.text ?? '').join('\n');
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(
      request.headers.authorization,
      undefined,
      'No ambient credential may reach the local model',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, 'qa-chat');
    const names = (body.tools ?? []).map((tool: any) => tool.function.name);
    const record = (observed[mode] ??= { calls: 0, toolNames: names });
    record.calls++;
    assert.equal(names.includes(toolName('generate_image')), mode === 'eligible');
    let name: string | undefined, args: unknown;
    if (phase === 0) {
      name = toolName('get_run_context');
      args = {};
    } else if (phase === 1) {
      const context = JSON.parse(resultText(body));
      const availability = context.runtimeCapabilities.imageGeneration;
      record.availability = availability;
      assert.equal(availability.available, mode === 'eligible');
      assert.equal(
        availability.reason,
        mode === 'eligible' ? 'confirmed-chat-adapter' : 'executable-extensions',
      );
      assert.equal(imagesCalls, mode === 'eligible' ? 0 : 1);
      if (mode === 'eligible') {
        name = toolName('generate_image');
        args = { prompt: 'Native other chat adapter fixture', background: 'opaque' };
      } else {
        name = 'write';
        args = { path: 'output/restriction.json', content: JSON.stringify(availability) };
      }
    } else if (phase === 2) {
      name = toolName('complete_stage');
      const path =
        mode === 'eligible'
          ? resultText(body).match(/image-[a-f0-9-]{36}\.png/)![0]
          : 'restriction.json';
      args = { outputs: [path] };
    } else {
      assert.equal(phase, 3);
      assert.match(resultText(body), /"validated"\s*:\s*true/);
    }
    phase++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (value: unknown) => response.write('data: ' + JSON.stringify(value) + '\n\n');
    const chunk = {
      id: 'qa-native-image-chat',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qa-chat',
    };
    if (name) {
      assert.ok(
        names.includes(name),
        'Fixture must invoke a genuinely exposed native tool: ' + name,
      );
      emit({
        ...chunk,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'qa-call-' + phase,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      emit({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      emit({
        ...chunk,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Native fixture completed.' },
            finish_reason: null,
          },
        ],
      });
      emit({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    emit({
      ...chunk,
      choices: [],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    response.end('data: [DONE]\n\n');
  } catch (error) {
    failure = error;
    response.writeHead(500);
    response.end('Owned fixture failed');
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const llm: Connection = {
  id: 'local-chat',
  name: 'Owned native chat fixture',
  providerId: 'studio-local-chat',
  purpose: 'local',
  authScope: 'connection',
  endpoint: 'http://127.0.0.1:' + port + '/v1',
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions',
    auth: 'none',
    models: [
      {
        id: 'qa-chat',
        name: 'QA chat',
        imageInput: false,
        reasoning: false,
        contextWindow: 32000,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [
  llm,
  {
    id: 'images',
    name: 'Owned Images fixture',
    providerId: 'openai',
    purpose: 'images',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
await store.saveSection('imageTool', { connectionId: 'images', modelId: 'gpt-image-2.5-flare' });
const agents: Agent[] = ['eligible', 'gated'].map((id) => ({
  id,
  name: id,
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: id === 'gated' ? ['qa-tool-scope'] : [],
  mainInstruction:
    'Execute only the explicit owned QA task. No other model, network, generation, desktop, dependencies or app/source modifications.',
  model: {
    connectionId: llm.id,
    provider: llm.providerId,
    id: 'qa-chat',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agents', agents);
const project = (
  await store.command({ kind: 'create', name: 'Native image capabilities — QA', agents })
).projects[0];
const directory = await store.projects.directory(project.id);
const gatedOutput = join(directory, project.agents[1].outputPath);
await mkdir(gatedOutput, { recursive: true });
const scope = await qaToolScope(root, gatedOutput);
await store.saveSection('resources', [scope.resource]);
const cryptKey = randomBytes(32);
let protectedStorage = 0;
const vault = new SecretVault(join(root, 'vault'), {
  isAsyncEncryptionAvailable: async () => {
    protectedStorage++;
    return true;
  },
  encryptStringAsync: async (text) => {
    protectedStorage++;
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', cryptKey, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  decryptStringAsync: async (bytes) => {
    protectedStorage++;
    const decipher = createDecipheriv('aes-256-gcm', cryptKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return {
      result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
      shouldReEncrypt: false,
    };
  },
});
const connections = new ImageConnections(
  service,
  vault,
  new ImagesApi(async (url, init) => {
    imagesCalls++;
    assert.equal(mode, 'eligible');
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(JSON.parse(String(init?.body)).model, 'gpt-image-2.5-flare');
    return Response.json({ data: [{ b64_json: libraryPng().toString('base64') }] });
  }),
);
await connections.save({
  folder: store.folder,
  connectionId: 'images',
  key: 'QA_SYNTHETIC_IMAGE_KEY_NOT_REAL',
});
const images = new ImageGeneration(service, connections, join(root, 'operations'));
const children: ReturnType<typeof spawn>[] = [],
  exits: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: resolve('bundled/pi-bridge/session.mjs'),
  catalog: resolve('bundled/pi-bridge/catalog.mjs'),
  piPath: () => pi.path,
  images,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    children.push(child);
    exits.push(
      new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      }),
    );
  },
});
const timeout = setTimeout(() => {
  host.close();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}, 60_000);
let passed = false;
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, nativeApis }));
  for (const id of ['eligible', 'gated'] as const) {
    mode = id;
    phase = 0;
    const secretReads = protectedStorage,
      request = { projectId: project.id, agentId: id, autoContinue: false };
    await host.launch({
      ...request,
      firstMessage:
        'Owned local native SDK fixture. Read get_run_context, then perform the explicit fixture image task only when the shared Images tool is available; otherwise write its actual restriction. Complete the actual output. No other tools/resources.',
    });
    assert.equal(await exits.at(-1), 0);
    assert.equal(failure, undefined);
    const state = await store.projects.read(project.id),
      agent = state.agents.find((agent) => agent.profile.id === id)!;
    assert.equal(agent.runStatus, 'ready');
    assert.equal(phase, 4);
    assert.equal(agent.profile.model!.provider, llm.providerId);
    assert.equal(agent.profile.model!.id, 'qa-chat');
    const text = await readFile(join(directory, agent.session!.path), 'utf8');
    assert.equal(text.includes('QA_SYNTHETIC_IMAGE_KEY_NOT_REAL'), false);
    const contextFiles = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(directory, '.pistudio/context')),
    );
    for (const file of contextFiles)
      assert.equal(
        (
          await readFile(join(directory, '.pistudio/context', file, 'context.json'), 'utf8')
        ).includes('runtimeCapabilities'),
        false,
      );
    if (id === 'gated') {
      assert.equal(
        protectedStorage,
        secretReads,
        'Unavailable runtime must not touch protected storage',
      );
      assert.equal(imagesCalls, 1);
    } else assert.equal(imagesCalls, 1);
    const calls = observed[id].calls;
    await host.launch(request);
    assert.equal(await exits.at(-1), 0);
    assert.equal(await readFile(join(directory, agent.session!.path), 'utf8'), text);
    assert.equal(observed[id].calls, calls);
    assert.equal(imagesCalls, 1);
  }
  const artifact = resolve('artifacts/native-image-capabilities-proof.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: JSON.parse(await readFile('package.json', 'utf8')).version,
        actualPi: pi.version,
        primarySource: 'https://github.com/earendil-works/pi/blob/v1.5.2/packages/ai/src/types.ts',
        sdkTypesSha256: createHash('sha256').update(types).digest('hex'),
        sdkSessionSha256: createHash('sha256').update(agentSdk).digest('hex'),
        chatSessionUsesStreamSimple: true,
        bridgeDoesNotExposeOtherModelImageOperations: true,
        confirmedNativeChatApis: nativeApis,
        assistantContentKinds: assistantContent,
        explicitImageApiRemainsUnknown: true,
        unknownApiRemainsUnknown: true,
        actualNativeClient: 'openai-completions',
        observed,
        imageFixtureCalls: imagesCalls,
        cloudModelRequests: 0,
        paidImageRequests: 0,
        realKeychainAccess: 0,
        exactIdleResumeWithoutReplay: true,
        noRuntimeCapabilitySnapshot: true,
        userStudioTouched: false,
        sourceSha256: Object.fromEntries(
          await Promise.all(
            [
              'src/main/images/imageRuntime.ts',
              'src/main/images/ImageGeneration.ts',
              'src/main/pi/createStudioRunHost.ts',
              'src/main/pi/RunLifecycle.ts',
              'bundled/pi-bridge/session.mjs',
              'scripts/smoke-native-image-capabilities.ts',
            ].map(async (path) => [
              path,
              createHash('sha256')
                .update(await readFile(path))
                .digest('hex'),
            ]),
          ),
        ),
        limits:
          'Actual native Pi protocol/tool transport driven by a local scripted SSE model and injected Images HTTP fixture, not a real non-Codex cloud account or artistic image generation.',
      },
      null,
      2,
    ) + '\n',
  );
  passed = true;
  console.log('Native other-chat image tools and executable-extension restriction passed.');
} finally {
  clearTimeout(timeout);
  host.close();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  await new Promise<void>((done) => server.close(() => done()));
  if (passed) await rm(root, { recursive: true, force: true });
  else console.log('Owned QA retained: ' + root);
}
