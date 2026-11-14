import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SavedAttachment } from '../src/shared/attachments.ts';
// @ts-expect-error Shared binary fixture has no TypeScript declarations.
import { libraryPng } from './fixtures/library.mjs';

const root = await mkdtemp(join(tmpdir(), 'pistudio-attachments-native-'));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
await mkdir(process.env.PI_CODING_AGENT_DIR);
const service = new StudioService(join(root, 'preferences.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
assert.equal(pi.supported, true);
const sources = join(root, 'Sources');
await mkdir(sources);
const png: Buffer = libraryPng(32, 32);
const document = Buffer.from('%PDF-1.7\nQA binary reference\n\0%%EOF');
const text = 'ATTACHMENT_TEXT_FROM_PROJECT_COPY';
await writeFile(join(sources, 'reference.png'), png);
await writeFile(join(sources, 'document.pdf'), document);
await writeFile(join(sources, 'brief.txt'), text);
const references = new ReferenceFiles();
const selected = await references.select(
  ['reference.png', 'document.pdf', 'brief.txt'].map((name) => join(sources, name)),
  store.folder,
);
const ids = selected.map((file) => file.id);
let requests = 0;
let attachments: SavedAttachment[] = [];
let serverFailure: unknown;
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(body.model, 'qa-vision');
    const step = requests++;
    assert.ok(step < 5, 'No unexpected model retry or replay');
    const system = JSON.stringify(
      body.messages.filter((m: { role: string }) => m.role === 'system'),
    );
    assert.ok(
      system.includes(projectRoot),
      'The current absolute project root reaches the system prompt',
    );
    assert.ok(system.includes('QA_ATTACHMENT_ROLE_CURRENT'));
    assert.equal(system.includes('QA_ATTACHMENT_ROLE_OLD'), false);
    assert.equal(
      system.includes('Inspect these references.'),
      false,
      'First user input stays separate from role instructions',
    );
    const user = body.messages.filter((m: { role: string }) => m.role === 'user');
    assert.equal(user.length, 1);
    const imageParts = user[0].content.filter(
      (part: { type: string }) => part.type === 'image_url',
    );
    assert.equal(imageParts.length, 1);
    assert.equal(imageParts[0].image_url.url, `data:image/png;base64,${png.toString('base64')}`);
    const input = user[0].content
      .filter((part: { type: string }) => part.type === 'text')
      .map((part: { text: string }) => part.text)
      .join('\n');
    assert.ok(input.startsWith('Inspect these references.'));
    const serialized = input
      .split('Input files (paths relative to project directory): ')[1]
      ?.split('\n')[0];
    assert.ok(serialized);
    const current: SavedAttachment[] = JSON.parse(serialized);
    assert.equal(current.length, 3);
    if (step === 0) {
      attachments = current;
      // Subsequent native tool calls must use copies, without original source files.
      await rm(sources, { recursive: true });
    } else assert.deepEqual(current, attachments);
    const toolHistory = JSON.stringify(
      body.messages.filter((m: { role: string }) => m.role === 'tool'),
    );
    if (step >= 1) assert.ok(toolHistory.includes(document.toString('base64')));
    if (step >= 2) assert.ok(toolHistory.includes(text));
    const available = body.tools.map((tool: { function: { name: string } }) => tool.function.name);
    let tool: string | undefined,
      args: Record<string, unknown> = {};
    if (step < 2) {
      tool = available.find((name: string) => name.endsWith('read_project_file'));
      args = {
        path: attachments[step === 0 ? 1 : 2].path,
        encoding: step === 0 ? 'base64' : 'utf8',
      };
    } else if (step === 2) {
      tool = available.find((name: string) => name === 'bash');
      args = { command: "printf 'REFERENCES_READ_OK' > output/result.txt" };
    } else if (step === 3) {
      tool = available.find((name: string) => name.endsWith('complete_stage'));
      args = { outputs: ['result.txt'] };
    }
    if (step < 4) assert.ok(tool, 'Actual native read MCP/bash/completion must be available');
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `attachment-${step}`,
              type: 'function',
              function: { name: tool, arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: 'assistant', content: 'References inspected.' };
    const chunk = (delta: object, finish_reason: string | null) => ({
      id: `attachment-${step}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
    response.end(
      `data: ${JSON.stringify({ ...chunk({}, tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    serverFailure = error;
    response.writeHead(500);
    response.end('Attachment QA rejected request');
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const connection = {
  id: 'qa-attachments',
  name: 'Local attachment fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-attachments'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [false, true].map((imageInput) => ({
      id: imageInput ? 'qa-vision' : 'qa-text',
      name: imageInput ? 'Vision' : 'Text only',
      imageInput,
      reasoning: false,
      contextWindow: 16384,
      maxTokens: 1024,
    })),
  },
};
await store.saveSection('connections', [connection]);
const agent: Agent = {
  id: 'qa-references',
  name: 'References',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  mainInstruction: 'QA_ATTACHMENT_ROLE_OLD',
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-text',
    reasoning: 'По умолчанию',
    temperature: '',
  },
};
await store.saveSection('agents', [agent]);
const project = (await store.command({ kind: 'create', name: 'References', agents: [agent] }))
  .projects[0];
const projectRoot = await store.projects.directory(project.id);
const children: { process: ChildProcess; exit: Promise<number | null>; errors: string }[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'Bootstraps'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  references,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const process = spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...globalThis.process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    const child = {
      process,
      exit: new Promise<number | null>((r, reject) => {
        process.once('error', reject);
        process.once('exit', r);
      }),
      errors: '',
    };
    process.stderr!.on('data', (bytes) => (child.errors += bytes.toString()));
    children.push(child);
  },
});
const deadline = setTimeout(() => {
  for (const child of children) child.process.kill('SIGKILL');
}, 60000);
try {
  const initial = await readFile(join(projectRoot, 'project.json'));
  await assert.rejects(
    () =>
      host.launch({
        projectId: project.id,
        agentId: agent.id,
        firstMessage: 'Do not send',
        attachments: ids,
        autoContinue: false,
      }),
    /поддержку изображений/,
  );
  assert.equal(requests, 0);
  assert.equal(children.length, 0);
  assert.deepEqual(await readFile(join(projectRoot, 'project.json')), initial);
  await assert.rejects(() => readdir(join(projectRoot, '.pistudio/context')), { code: 'ENOENT' });
  await store.saveSection('agents', [
    {
      ...agent,
      mainInstruction: 'QA_ATTACHMENT_ROLE_CURRENT',
      model: { ...agent.model!, id: 'qa-vision' },
    },
  ]);
  await host.launch({
    projectId: project.id,
    agentId: agent.id,
    firstMessage: 'Inspect these references.',
    attachments: ids,
    autoContinue: false,
  });
  assert.equal(await children[0].exit, 0, children[0].errors);
  if (serverFailure) throw serverFailure;
  assert.equal(requests, 5);
  const result = await store.projects.read(project.id);
  assert.equal(result.agents[0].runStatus, 'ready');
  assert.equal(
    await readFile(join(projectRoot, result.agents[0].outputPath, 'result.txt'), 'utf8'),
    'REFERENCES_READ_OK',
  );
  for (const [index, bytes] of [png, document, Buffer.from(text)].entries()) {
    assert.deepEqual(await readFile(join(projectRoot, attachments[index].path)), bytes);
    assert.equal(attachments[index].sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const binding = result.agents[0].session!;
  const transcriptPath = join(projectRoot, binding.path);
  const transcript = await readFile(transcriptPath, 'utf8');
  const userMessages = transcript
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.type === 'message' && e.message.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(
    userMessages[0].message.content.filter((part: { type: string }) => part.type === 'image')
      .length,
    1,
  );
  await assert.rejects(
    () =>
      host.launch({
        projectId: project.id,
        agentId: agent.id,
        autoContinue: false,
        attachments: ids,
      }),
    /только вместе с первым сообщением нового диалога/,
  );
  await assert.rejects(
    () =>
      host.launch({
        projectId: project.id,
        agentId: agent.id,
        autoContinue: false,
        firstMessage: 'Do not replay',
        attachments: ids,
      }),
    /не отправляет референсы повторно/,
  );
  await host.launch({ projectId: project.id, agentId: agent.id, autoContinue: false });
  assert.equal(await children[1].exit, 0, children[1].errors);
  assert.equal(requests, 5);
  assert.deepEqual((await store.projects.read(project.id)).agents[0].session, binding);
  assert.equal(await readFile(transcriptPath, 'utf8'), transcript);
  const records = await Promise.all(
    (await readdir(join(projectRoot, '.pistudio/context'))).map(async (id) =>
      JSON.parse(
        await readFile(join(projectRoot, '.pistudio/context', id, 'context.json'), 'utf8'),
      ),
    ),
  );
  assert.equal(records.length, 2);
  assert.equal(records.filter((record) => record.attachments?.length).length, 1);
  assert.ok(!JSON.stringify(records).includes(agent.mainInstruction!));
  assert.ok(!JSON.stringify(records).includes('QA_ATTACHMENT_ROLE_CURRENT'));
  const proof = {
    pi: pi.version,
    sourceVersion: JSON.parse(await readFile(resolve('package.json'), 'utf8')).version,
    passed: {
      nonVisualRejectedBeforeContextSessionOrRequest: true,
      realNativeImageWireMatchesOriginalPng: true,
      singleCanonicalUserImage: true,
      copiedPdfAndTextReadThroughInternalMcpAfterOriginalsRemoved: true,
      fileHashesPreserved: true,
      completionValidated: true,
      resumeRejectsNewAttachmentIds: true,
      exactIdleResumeNoReplayOrTranscriptChange: true,
      noInstructionSnapshots: true,
      currentRoleAndAbsoluteProjectRootInSystemPrompt: true,
      firstUserMessageSeparateFromRole: true,
    },
    localModelRequests: requests,
    externalModelRequests: 0,
    limits:
      'Real production RunHost/context/references/bridge/native Pi SDK and internal MCP. Synthetic loopback model chooses tools; no artistic/vision inference or PDF text extraction claimed. Terminal dispatch is a hidden child; user studio and cloud accounts are untouched.',
    sourceSha256: Object.fromEntries(
      await Promise.all(
        [
          'scripts/smoke-pi-attachments.ts',
          'src/main/pi/ReferenceFiles.ts',
          'src/main/pi/createStudioRunHost.ts',
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
    resolve('artifacts/native-attachments-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  clearTimeout(deadline);
  host.close();
  await Promise.allSettled(children.map((child) => child.exit));
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(root, { recursive: true, force: true });
}
