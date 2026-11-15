import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { SecretVault } from '../src/main/storage/SecretVault.ts';
import { ImageConnections } from '../src/main/images/ImageConnections.ts';
import { ImagesApi } from '../src/main/images/ImagesApi.ts';
import { ImageGeneration } from '../src/main/images/ImageGeneration.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import { libraryPng } from './fixtures/library.mjs';

// Opt-in real subscription request. Images HTTP is a fixture; no paid Images API request occurs.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-images-'));
const referenceMode = process.argv.includes('--references');
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const cryptKey = randomBytes(32),
  token = 'QA_IMAGE_KEY_NOT_A_REAL_CREDENTIAL';
const vault = new SecretVault(join(root, 'secrets'), {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text) => {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', cryptKey, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  decryptStringAsync: async (data) => {
    const decipher = createDecipheriv('aes-256-gcm', cryptKey, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return {
      result: Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(
        'utf8',
      ),
      shouldReEncrypt: false,
    };
  },
});
let calls = 0;
const connections = new ImageConnections(
  service,
  vault,
  new ImagesApi(async (url, init) => {
    assert.equal(
      url,
      `https://api.openai.com/v1/images/${referenceMode ? 'edits' : 'generations'}`,
    );
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    const form = referenceMode ? await new Request(String(url), init).formData() : undefined;
    const body = form ? Object.fromEntries(form) : JSON.parse(String(init.body));
    assert.equal(body.model, 'gpt-image-2.5-flare');
    assert.equal(Number(body.n), 1);
    assert.equal(body.output_format, 'png');
    if (form) {
      const files = form.getAll('image[]') as File[];
      assert.equal(files.length, 1);
      assert.equal(files[0].type, 'image/png');
      assert.deepEqual(Buffer.from(await files[0].arrayBuffer()), libraryPng());
    }
    calls++;
    return Response.json({
      data: [{ b64_json: libraryPng().toString('base64') }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  }),
);
const images = new ImageGeneration(service, connections, join(root, 'operations'));
const packageRoot = join(root, 'skill-only-package');
await mkdir(join(packageRoot, 'skill'), { recursive: true });
await writeFile(
  join(packageRoot, 'package.json'),
  JSON.stringify({ name: 'qa-image-skill-package', version: '1.0.0', pi: { skills: ['./skill'] } }),
);
await writeFile(
  join(packageRoot, 'skill/SKILL.md'),
  '---\nname: image-protocol-qa\ndescription: QA-only image protocol marker.\n---\nFollow the explicit current test task. This skill adds no executable image generator.\n',
);
const agent: Agent = {
  id: 'qa-image-agent',
  name: 'Image QA',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: ['qa-skill-package'],
  mainInstruction:
    'Execute only the explicit current test task. Use Pi Studio production MCP tools. No external generation, no other models, no administrative tools.',
  model: {
    connectionId: 'llm',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Средний',
    temperature: '',
  },
};
await store.saveSection('agents', [agent]);
await store.saveSection('resources', [
  {
    id: 'qa-skill-package',
    name: 'QA skill-only package',
    kind: 'plugins',
    source: packageRoot,
    version: '1',
    description: 'QA only',
    transport: '',
    args: '',
    credential: '',
    contents: '',
    createdAt: 1,
  },
]);
await store.saveSection('connections', [
  {
    id: 'llm',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
  {
    id: 'images',
    name: 'QA fixture Images API',
    purpose: 'images',
    providerId: 'openai',
    endpoint: '',
    account: '',
    createdAt: 2,
  },
]);
await store.saveSection('imageTool', { connectionId: 'images', modelId: 'gpt-image-2.5-flare' });
await connections.save({ folder: store.folder, connectionId: 'images', key: token });
const project = (
  await store.command({ kind: 'create', name: 'Image protocol QA', agents: [agent] })
).projects[0];
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  images,
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
  if (referenceMode) {
    const root = await store.projects.directory(project.id);
    await mkdir(join(root, 'references'));
    await writeFile(join(root, 'references/input.png'), libraryPng());
  }
  const request = { projectId: project.id, agentId: agent.id, autoContinue: false };
  await host.launch({
    ...request,
    firstMessage: `Isolated integration test. First call get_run_context and verify runtimeCapabilities.imageGeneration.available is true. Then call generate_image exactly once with prompt "QA image protocol check" and background "transparent".${referenceMode ? ' Pass references: ["references/input.png"], relative to the project root, as an image reference to the tool.' : ''} It uses a fixture API; do not call any other generator. Read the returned PNG from your output to verify it exists. Then call complete_stage with that output-relative PNG filename. Do not ask questions. Do not expose credentials, use another model or generate any extra files.`,
  });
  assert.equal(await children[0], 0);
  let current = await store.projects.read(project.id);
  assert.equal(current.agents[0].runStatus, 'ready');
  assert.equal(calls, 1);
  const directory = await store.projects.directory(project.id),
    output = join(directory, current.agents[0].outputPath);
  const files = await readdir(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /^image-[a-f0-9-]{36}\.png$/);
  assert.deepEqual(await readFile(join(output, files[0])), libraryPng());
  assert.equal(current.agents[0].profile.model?.id, agent.model!.id);
  const session = current.agents[0].session!,
    transcript = await readFile(join(directory, session.path), 'utf8');
  assert.equal(transcript.includes(token), false);
  const contextMessage = transcript
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .map((entry) => entry.message)
    .find(
      (message) =>
        message?.role === 'toolResult' &&
        message.toolName === 'mcp__pi_studio__get_run_context' &&
        !message.isError,
    );
  assert.ok(contextMessage, 'Actual native MCP must return current runtime capabilities');
  const runtime = JSON.parse(contextMessage.content.find((part: any) => part.type === 'text').text)
    .runtimeCapabilities.imageGeneration;
  assert.equal(runtime.available, true);
  assert.equal(runtime.reason, 'confirmed-chat-adapter');
  assert.equal((await readFile(join(directory, 'project.json'), 'utf8')).includes(token), false);
  const operationFiles = await readdir(join(root, 'operations'));
  const operationData = await readFile(join(root, 'operations', operationFiles[0]), 'utf8');
  const operation = JSON.parse(operationData).operations[0];
  assert.equal(operation.state, 'saved');
  if (referenceMode) {
    assert.deepEqual(operation.referenceHashes, [
      createHash('sha256').update(libraryPng()).digest('hex'),
    ]);
    assert.deepEqual(await readFile(join(directory, 'references/input.png')), libraryPng());
  }
  assert.equal(operation.path, `${current.agents[0].outputPath}/${files[0]}`);
  assert.equal(transcript.includes(operation.id), true);
  assert.equal(operationData.includes(token), false);
  assert.equal(operationData.includes('QA image protocol check'), false);
  await host.launch(request);
  assert.equal(await children[1], 0);
  current = await store.projects.read(project.id);
  assert.equal(current.agents[0].session?.path, session.path);
  assert.equal(calls, 1, 'Idle exact resume must not repeat a paid tool operation.');
  const messages = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === 'message').length;
  assert.equal(
    messages(await readFile(join(directory, session.path), 'utf8')),
    messages(transcript),
  );
  const proof = {
    checkedAt: new Date().toISOString(),
    applicationVersion: JSON.parse(await readFile(resolve('package.json'), 'utf8')).version,
    piVersion: pi.version,
    selectedModel: agent.model!.id,
    referenceMode,
    passed: {
      currentNativeMcpSchemaAndCall: true,
      actualRuntimeImageAvailability: true,
      actualOrderedReferenceBytesInMultipart: referenceMode,
      outputBoundToAgentAndValidated: true,
      operationMetadataOmitsKeysAndPrompts: true,
      modelUnchanged: true,
      completionValidated: true,
      exactIdleResumeWithoutReplay: true,
    },
    imagesHttpCalls: calls,
    paidImagesApiRequests: 0,
    limits:
      'Actual configured Codex subscription request and native Pi SDK/production bridge; Images HTTP is an injected fixture, no real image generation. Secret protection uses test AES, not macOS Keychain. Own temporary studio only; no Terminal UI or user studio changes.',
    sourceSha256: Object.fromEntries(
      await Promise.all(
        [
          'scripts/smoke-pi-images.ts',
          'src/main/images/ImageGeneration.ts',
          'src/main/images/ImagesApi.ts',
          'src/main/images/imageReferences.ts',
          'src/main/images/tools.ts',
          'bundled/pi-bridge/session.mjs',
        ].map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(resolve(path)))
            .digest('hex'),
        ]),
      ),
    ),
  };
  await writeFile(
    resolve('artifacts/image-mcp-runtime-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    `Real Pi Images MCP passed (${referenceMode ? 'multipart reference edits' : 'text generation'}): selected Codex model calls the session-bound production tool, fixture HTTP produces a validated local PNG in its own output, usage/operation metadata omit keys and prompts, validated completion and exact idle resume work without repeating a request. No paid Images API request was made.`,
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
