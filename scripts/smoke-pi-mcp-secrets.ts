import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { SecretVault } from '../src/main/storage/SecretVault.ts';
import { McpSecrets } from '../src/main/pi/McpSecrets.ts';
import { RunHost } from '../src/main/pi/RunHost.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

// Actual subscription request and native MCP transport. Only synthetic credentials and an isolated studio.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-mcp-secrets-'));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
const native = join(root, 'NativePi');
await mkdir(native);
process.env.PI_CODING_AGENT_DIR = native;
const secret = '!QA_SYNTHETIC_${HOME}_MCP_KEY';
const marker = 'AUTHENTICATED_NATIVE_MCP';
let accepted = 0,
  toolCalls = 0,
  rejected = 0;
const server = createServer(async (request, response) => {
  if (request.headers.authorization !== 'Bearer ' + secret) {
    rejected++;
    response.writeHead(401);
    response.end();
    return;
  }
  accepted++;
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let text = '';
  for await (const chunk of request) text += chunk;
  const data = JSON.parse(text);
  if (!('id' in data)) {
    response.writeHead(202);
    response.end();
    return;
  }
  let result;
  if (data.method === 'initialize')
    result = {
      protocolVersion: data.params.protocolVersion,
      serverInfo: { name: 'Protected native fixture', version: '1' },
      capabilities: { tools: {} },
    };
  else if (data.method === 'tools/list')
    result = {
      tools: [
        {
          name: 'protected_value',
          description: 'Get the protected isolated test marker. No arguments.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    };
  else if (data.method === 'tools/call' && data.params.name === 'protected_value') {
    toolCalls++;
    result = { content: [{ type: 'text', text: marker }] };
  } else result = {};
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
await writeFile(
  join(native, 'mcp.json'),
  JSON.stringify({
    mcpServers: {
      protected: {
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { Authorization: 'Bearer ${TEST_KEY}' },
      },
    },
  }),
);
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio')),
  store = await service.load();
const resource: Resource = {
  id: 'protected',
  name: 'Protected fixture',
  kind: 'mcps',
  source: 'pi:protected',
  version: '',
  description: '',
  transport: 'HTTP',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
await store.saveSection('resources', [resource]);
const encryptionKey = randomBytes(32);
const vault = new SecretVault(join(root, 'Secrets'), {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text) => {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', encryptionKey, iv),
      body = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  },
  decryptStringAsync: async (bytes) => {
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return {
      result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
      shouldReEncrypt: false,
    };
  },
});
const pi = await checkPi(''),
  secrets = new McpSecrets(service, vault, () => pi.path);
const request = { folder: store.folder, resourceId: resource.id };
const status = await secrets.status(request);
await secrets.save({ ...request, revision: status.revision, values: { TEST_KEY: secret } });
const agent: Agent = {
  id: 'protected-agent',
  name: 'Protected agent',
  enabled: true,
  skills: [],
  mcps: [resource.id],
  plugins: [],
  instructions: [],
  mainInstruction:
    'Use the assigned protected_value MCP tool. Write only the returned marker to output/proof.txt and report complete_stage with proof.txt. Do not inspect credentials or ask questions.',
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
};
await store.saveSection('agents', [agent]);
const project = (await store.command({ kind: 'create', name: 'Protected run', agents: [agent] }))
  .projects[0];
const children: Promise<number | null>[] = [];
const host = new RunHost({
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  headless: true,
  prepare: (request) =>
    service.serialize(async () => ({
      piPath: pi.path,
      run: await buildRunContext(
        await store.projects.directory(request.projectId),
        await store.projects.read(request.projectId),
        request.agentId,
        [agent],
        store.bootstrap().sections.resources as Resource[],
        secrets.resolver(store.folder, pi.path),
      ),
    })),
  update: (run, status, session) =>
    service.serialize(() =>
      store.projects.updateRuntime(run.project.id, run.agent.profile.id, status, session),
    ),
  read: (run) => service.serialize(() => store.projects.read(run.project.id)),
  openTerminal: async (node, bridge, bootstrap) => {
    const env = { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' };
    if (oldAgentDir === undefined) delete env.PI_CODING_AGENT_DIR;
    else env.PI_CODING_AGENT_DIR = oldAgentDir;
    const child = spawn(node, [bridge, bootstrap], { stdio: 'ignore', env });
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
    agentId: agent.id,
    autoContinue: false,
    firstMessage:
      'Perform the isolated protected MCP check using your role. The file must contain exactly the marker from protected_value. Signal completion through Pi Studio.',
  });
  assert.equal(await children[0], 0);
  const finished = await store.projects.read(project.id),
    directory = await store.projects.directory(project.id);
  assert.equal(finished.agents[0].runStatus, 'ready');
  assert.ok(toolCalls >= 1);
  assert.equal(rejected, 0);
  assert.equal(
    (await readFile(join(directory, finished.agents[0].outputPath, 'proof.txt'), 'utf8')).trim(),
    marker,
  );
  const transcript = await readFile(join(directory, finished.agents[0].session!.path), 'utf8');
  const calls = toolCalls,
    connections = accepted;
  await host.launch({ projectId: project.id, agentId: agent.id, autoContinue: false });
  assert.equal(await children[1], 0);
  assert.ok(accepted > connections, 'Native MCP must authenticate again on exact resume');
  assert.equal(toolCalls, calls, 'Idle resume must not replay the model request');
  assert.equal(
    await readFile(join(directory, finished.agents[0].session!.path), 'utf8'),
    transcript,
  );
  async function checkFiles(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await checkFiles(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file, 'utf8');
        assert.equal(bytes.includes(secret), false, `No plaintext credential in ${entry.name}`);
        assert.equal(
          bytes.includes('QA_SYNTHETIC_'),
          false,
          `No escaped credential in ${entry.name}`,
        );
      }
    }
  }
  await checkFiles(store.folder);
  await checkFiles(join(root, 'boots'));
  await checkFiles(join(root, 'Secrets'));
  assert.equal((await readFile(join(native, 'mcp.json'), 'utf8')).includes(secret), false);
  console.log(
    JSON.stringify({
      ok: true,
      nativeSdk: pi.version,
      protectedToolCalls: toolCalls,
      exactResume: true,
      resourceReapplied: true,
      plaintextInStudio: false,
      realApiKeysUsed: false,
    }),
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(root, { recursive: true, force: true });
}
