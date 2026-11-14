import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../src/main/pi/RunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import type { Agent } from '../src/shared/studio.ts';
import { libraryPng } from './fixtures/library.mjs';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { readProjectFile } from '../src/main/pi/projectFiles.ts';
import type { SavedAttachment } from '../src/shared/attachments.ts';

// Real pinned SDK, bridge and loopback MCP; seeded history, no generation/model request.
const image = libraryPng();
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-sdk-project-moves-'));
const service = new StudioService(join(temporary, 'prefs.json'), join(temporary, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
assert.equal(pi.supported, true);
const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
const profiles: Agent[] = ['first', 'archived'].map((id) => ({
  id,
  name: id,
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  mainInstruction: 'CURRENT_ONLY_INSTRUCTION: do not start work until the user asks.',
  model: {
    connectionId: 'qa',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
}));
await store.saveSection('agents', profiles);
const original = (await store.command({ kind: 'create', name: 'Before', agents: profiles }))
  .projects[0];
const originalRoot = await store.projects.directory(original.id);
const snapshots = new Map<string, { path: string; bytes: Buffer; entries: unknown[] }>();
const inputs = new Map<
  string,
  {
    directory: string;
    metadata: Buffer;
    attachments: SavedAttachment[];
    bytes: Buffer[];
  }
>();
const references = new ReferenceFiles();
const sources = join(temporary, 'source-inputs');
await mkdir(join(sources, 'a'), { recursive: true });
await mkdir(join(sources, 'b'), { recursive: true });
await writeFile(join(sources, 'a/same.txt'), 'First separate input');
await writeFile(join(sources, 'b/same.txt'), 'Second separate input');
await writeFile(join(sources, 'reference.png'), image);
const selected = await references.select(
  [join(sources, 'a/same.txt'), join(sources, 'b/same.txt'), join(sources, 'reference.png')],
  store.folder,
);
const parse = (bytes: Buffer) =>
  bytes
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
for (const agent of original.agents) {
  const initial = await buildRunContext(originalRoot, original, agent.profile.id, profiles, []);
  await references.attach(
    initial,
    selected.map((item) => item.id),
    store.folder,
    true,
  );
  const attachments = initial.record.attachments!;
  const inputDirectory = join(dirname(agent.outputPath), 'runs', initial.record.runId);
  inputs.set(agent.profile.id, {
    directory: inputDirectory,
    metadata: await readFile(join(originalRoot, inputDirectory, 'attachments.json')),
    attachments,
    bytes: await Promise.all(attachments.map((item) => readFile(join(originalRoot, item.path)))),
  });
  assert.notEqual(attachments[0].path, attachments[1].path);
  assert.equal(attachments[0].name, attachments[1].name);
  const cwd = join(originalRoot, dirname(agent.outputPath));
  const manager = sdk.SessionManager.create(cwd, join(cwd, 'sessions'));
  manager.appendMessage({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Seeded first message for ${agent.profile.id}. Input files (paths relative to project directory): ${JSON.stringify(attachments)}`,
      },
      { type: 'image', mimeType: 'image/png', data: image.toString('base64') },
    ],
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Seeded response. Waiting for user.' }],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const path = relative(originalRoot, manager.getSessionFile());
  const bytes = await readFile(manager.getSessionFile());
  snapshots.set(agent.profile.id, { path, bytes, entries: parse(bytes).slice(1) });
  await store.projects.updateRuntime(original.id, agent.profile.id, 'stopped', {
    id: manager.getSessionId(),
    title: agent.profile.name,
    path,
    createdAt: 123,
  });
  await writeFile(
    join(originalRoot, agent.outputPath, 'script.md'),
    `Result for ${agent.profile.id}`,
  );
}
// The original chooser files no longer exist. Every subsequent read must use
// the copied project input, including after native SDK session forking.
await rm(sources, { recursive: true });
await store.command({ kind: 'remove-agent', projectId: original.id, agentId: 'archived' });
const children: Promise<number | null>[] = [];
let requests = 0;
const host = new RunHost({
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  bootstraps: join(temporary, 'boots'),
  headless: true,
  prepare: (request) =>
    service.serialize(async () => ({
      run: await buildRunContext(
        await store.projects.directory(request.projectId),
        await store.projects.read(request.projectId),
        request.agentId,
        profiles,
        [],
      ),
      piPath: pi.path,
    })),
  update: (run, status, session) =>
    service.serialize(() =>
      store.projects.updateRuntime(run.project.id, run.agent.profile.id, status, session),
    ),
  read: (run) => service.serialize(() => store.projects.read(run.project.id)),
  beforeRequest: async () => {
    requests++;
    throw new Error('This regression test must never send a model request.');
  },
  openTerminal: async (_node, bridge, bootstrap) => {
    const child = spawn(join(dirname(pi.path), 'node'), [bridge, bootstrap], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code) reject(new Error(`Bridge failed (${code}): ${stderr.slice(-1500)}`));
          else resolve(code);
        });
      }),
    );
  },
});
async function resume(projectId: string, agentId: string) {
  const index = children.length;
  const result = await host.launch({ projectId, agentId, autoContinue: false });
  assert.equal(await children[index], 0);
  const project = await store.projects.read(projectId);
  const agent = project.agents.find((item) => item.profile.id === agentId)!;
  assert.equal(agent.session?.needsFork, undefined);
  const root = await store.projects.directory(projectId);
  const session = join(root, agent.session!.path);
  const lines = parse(await readFile(session));
  assert.equal(lines[0].cwd, join(root, dirname(agent.outputPath)));
  assert.equal(lines[0].id, agent.session!.id);
  assert.equal(agent.session!.createdAt, 123);
  assert.deepEqual(
    lines.slice(1, snapshots.get(agentId)!.entries.length + 1),
    snapshots.get(agentId)!.entries,
  );
  assert.equal(
    lines.filter((entry) => entry.type === 'message').length,
    2,
    'Resume must not replay the first request or add generated messages',
  );
  const context = JSON.parse(
    await readFile(join(root, '.pistudio/context', result.runId, 'context.json'), 'utf8'),
  );
  assert.equal(context.projectRoot, root);
  assert.equal(context.cwd, lines[0].cwd);
  assert.equal(JSON.stringify(context).includes('CURRENT_ONLY_INSTRUCTION'), false);
  assert.equal(context.attachments, undefined, 'Resume must not reattach inputs to a new request');
  await assert.rejects(stat(join(root, dirname(agent.outputPath), 'runs', result.runId)), {
    code: 'ENOENT',
  });
  const input = inputs.get(agentId)!;
  assert.deepEqual(await readFile(join(root, input.directory, 'attachments.json')), input.metadata);
  for (const [index, attachment] of input.attachments.entries()) {
    const actual = await readFile(join(root, attachment.path));
    assert.deepEqual(actual, input.bytes[index]);
    assert.equal(createHash('sha256').update(actual).digest('hex'), attachment.sha256);
    const fromTool = await readProjectFile(root, { path: attachment.path, encoding: 'base64' });
    assert.deepEqual(Buffer.from(fromTool.content, 'base64'), actual);
    if (attachment.image)
      assert.deepEqual(await readFile(join(root, attachment.image.path)), image);
  }
  return { project, session, lines, binding: agent.session! };
}
async function verifyMoved(projectId: string) {
  const root = await store.projects.directory(projectId);
  const first = await resume(projectId, 'first');
  assert.notEqual(first.binding.path, snapshots.get('first')!.path);
  assert.equal(first.lines[0].parentSession, join(root, snapshots.get('first')!.path));
  assert.deepEqual(
    await readFile(join(root, snapshots.get('first')!.path)),
    snapshots.get('first')!.bytes,
  );
  const second = await resume(projectId, 'first');
  assert.equal(
    second.binding.path,
    first.binding.path,
    'A second resume must use the exact new session, not fork again',
  );
  assert.equal(second.binding.id, first.binding.id);
  await store.command({ kind: 'restore-agent', projectId, agentId: 'archived' });
  await resume(projectId, 'archived');
  assert.deepEqual(
    await readFile(join(root, snapshots.get('archived')!.path)),
    snapshots.get('archived')!.bytes,
  );
  return first;
}
try {
  const result = await host.withProjectChange(original.id, false, () =>
    service.serialize(() => store.command({ kind: 'clone', projectId: original.id, name: 'Copy' })),
  );
  const copy = result.projects.find((item) => item.id === result.selectedId)!;
  await verifyMoved(copy.id);
  for (const snapshot of snapshots.values())
    assert.deepEqual(await readFile(join(originalRoot, snapshot.path)), snapshot.bytes);
  await host.withProjectChange(original.id, true, () =>
    service.serialize(() =>
      store.command({ kind: 'rename', projectId: original.id, name: 'Renamed' }),
    ),
  );
  const moved = await verifyMoved(original.id);
  assert.equal(moved.project.id, original.id);
  // A missing canonical file remains an error; it must not create a replacement session.
  await rm(moved.session);
  const binding = (await store.projects.read(original.id)).agents[0].session;
  await assert.rejects(
    host.launch({ projectId: original.id, agentId: 'first', autoContinue: false }),
  );
  assert.equal((await store.projects.read(original.id)).agents[0].session?.id, binding?.id);
  assert.equal(requests, 0);
  console.log(
    JSON.stringify({
      ok: true,
      sdk: pi.version,
      cloneAndRename: true,
      archivedAgent: true,
      exactSecondResume: true,
      preservedImageHistory: true,
      productionAttachments: true,
      duplicateFilenamesAndHashes: true,
      originalsRemoved: true,
      attachmentReplay: false,
      modelRequests: requests,
    }),
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(temporary, { recursive: true, force: true });
}
