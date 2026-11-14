import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { readPiCatalog } from '../src/main/pi/catalog.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import type { Agent } from '../src/shared/studio.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-reasoning-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const sdkPath = await resolvePiSdk(await realpath(pi.path));
const sdk = await import(pathToFileURL(sdkPath).href);
const catalogPath = new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname;
const catalog = await readPiCatalog(pi.path, catalogPath, store.folder);
const selected = catalog.models.find(
  (m) => m.provider === 'openai-codex' && m.id === 'gpt-6.1-sol',
);
assert.ok(selected?.reasoningLevels?.includes('max'));
assert.equal(selected.reasoningLevels.includes('off'), false);
assert.equal(selected.defaultReasoningLevel, 'medium');
const plain = catalog.models.find((m) => m.provider === 'openai' && m.id === 'gpt-4o');
assert.deepEqual(plain?.reasoningLevels, ['off']);
assert.equal(plain.defaultReasoningLevel, 'off');
const agent: Agent = {
  id: 'qa-thinking',
  name: 'QA thinking',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: 'qa',
    provider: selected.provider,
    id: selected.id,
    reasoning: 'Средний',
    temperature: '',
  },
};
await store.saveSection('agents', [agent]);
await store.saveSection('connections', [
  {
    id: 'qa',
    name: 'Existing Pi subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const project = (await store.command({ kind: 'create', name: 'Thinking QA', agents: [agent] }))
  .projects[0];
const projectRoot = await store.projects.directory(project.id);
const cwd = join(projectRoot, dirname(project.agents[0].outputPath));
const manager = sdk.SessionManager.create(cwd, join(cwd, 'sessions'));
manager.appendModelChange(selected.provider, selected.id);
manager.appendThinkingLevelChange('high');
manager.appendMessage({
  role: 'user',
  content: [{ type: 'text', text: 'Synthetic stored QA history; do not execute or replay.' }],
  timestamp: 1,
});
manager.appendMessage({
  role: 'assistant',
  content: [{ type: 'text', text: 'Synthetic stored QA response.' }],
  api: 'openai-codex-responses',
  provider: selected.provider,
  model: selected.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 2,
});
const sessionPath = manager.getSessionFile()!;
await store.projects.updateRuntime(project.id, agent.id, 'idle', {
  id: manager.getSessionId(),
  path: relative(projectRoot, sessionPath),
  title: 'Synthetic history',
  createdAt: 1,
});
const messages = async () =>
  (await readFile(sessionPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === 'message');
const before = await messages();
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: catalogPath,
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
const results: object[] = [];
try {
  for (const [selection, expected] of [
    ['Низкий', 'low'],
    ['low', 'low'],
    ['По умолчанию', 'medium'],
    ['Предельный', 'max'],
    ['Высокий', 'high'],
  ]) {
    await store.saveSection('agents', [
      { ...agent, model: { ...agent.model!, reasoning: selection } },
    ]);
    const opened = await host.launch({
      projectId: project.id,
      agentId: agent.id,
      autoContinue: false,
    });
    assert.equal(
      await children.at(-1),
      0,
      'Bridge checks actual session thinking level equals the explicit level',
    );
    const context = JSON.parse(
      await readFile(join(projectRoot, '.pistudio/context', opened.runId, 'context.json'), 'utf8'),
    );
    assert.equal(context.model.thinkingLevel, expected);
    assert.deepEqual(
      await messages(),
      before,
      'Idle resume must not send/replay or create model messages',
    );
    assert.equal(
      (await store.projects.read(project.id)).agents[0].session?.path,
      relative(projectRoot, sessionPath),
    );
    results.push({
      selection,
      effective: context.model.thinkingLevel,
      exactSession: true,
      unchangedMessages: true,
    });
  }
  const contexts = await readdir(join(projectRoot, '.pistudio/context'));
  const projectBytes = await readFile(join(projectRoot, 'project.json'));
  for (const reasoning of ['typo', 'off', '']) {
    await store.saveSection('agents', [{ ...agent, model: { ...agent.model!, reasoning } }]);
    await assert.rejects(
      () => host.launch({ projectId: project.id, agentId: agent.id, autoContinue: false }),
      /рассуждения/,
    );
    assert.equal(children.length, 5);
    assert.deepEqual(await readdir(join(projectRoot, '.pistudio/context')), contexts);
    assert.deepEqual(await readFile(join(projectRoot, 'project.json')), projectBytes);
  }
  const proof = {
    passed: true,
    pi: pi.version,
    sessions: results,
    unsupportedRejectedBeforeContext: true,
    catalog: { reasoning: selected.reasoningLevels, plain: plain.reasoningLevels },
    modelRequests: 0,
    syntheticHistory: true,
    scope:
      'Actual SDK/native bridge; exact idle resumes with existing subscription status. No new messages or external model requests.',
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/reasoning-runtime-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
