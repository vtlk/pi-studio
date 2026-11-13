import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../src/main/pi/RunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { getProviderStatus } from '../src/main/pi/provider.ts';
import type { Agent } from '../src/shared/studio.ts';

// Opt-in integration: one short real subscription request in an isolated studio, then exact resume.
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-live-session-'));
const pi = await checkPi('');
assert.equal((await getProviderStatus(pi.path, 'openai-codex')).status, 'ready');
const agent: Agent = {
  id: 'qa-agent',
  name: 'Session smoke',
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  mainInstruction:
    'Follow the user precisely. Write deliverables in output and signal completion through Pi Studio MCP.',
  model: {
    connectionId: 'qa-connection',
    provider: 'openai-codex',
    id: 'gpt-6.1-sol',
    reasoning: 'Низкий',
    temperature: '',
  },
};
const store = await StudioStore.open(join(temporary, 'Studio'));
await store.saveSection('agents', [agent]);
const created = await store.command({ kind: 'create', name: 'Live SDK check', agents: [agent] });
const projectId = created.selectedId!;
const children: Promise<number | null>[] = [];
const host = new RunHost({
  bootstraps: join(temporary, 'bootstraps'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  headless: true,
  prepare: async (request) => ({
    run: await buildRunContext(
      await store.projects.directory(projectId),
      await store.projects.read(projectId),
      request.agentId,
      [agent],
      [],
    ),
    piPath: pi.path,
  }),
  update: (run, status, session) =>
    store.projects.updateRuntime(run.project.id, run.agent.profile.id, status, session),
  read: (run) => store.projects.read(run.project.id),
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    child.stderr.on('data', () => {}); // Do not print provider output or credentials.
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
try {
  const started = await host.launch({
    projectId,
    agentId: agent.id,
    autoContinue: false,
    firstMessage:
      'Create output/hello.txt containing exactly PISTUDIO_REAL_SESSION_OK and a newline. Then call the Pi Studio complete_stage tool with outputs ["hello.txt"]. Do not do anything else.',
  });
  assert.ok(started.project.agents[0].session);
  const firstExit = await children[0];
  assert.equal(firstExit, 0, 'Pi bridge must complete normally');
  const finished = await store.projects.read(projectId);
  assert.equal(finished.agents[0].runStatus, 'ready');
  const binding = finished.agents[0].session!;
  const root = await store.projects.directory(projectId);
  assert.equal(
    await readFile(join(root, 'agents/qa-agent/output/hello.txt'), 'utf8'),
    'PISTUDIO_REAL_SESSION_OK\n',
  );
  const transcript = await readFile(join(root, binding.path), 'utf8');
  assert.ok(transcript.includes('PISTUDIO_REAL_SESSION_OK'));
  const beforeFiles = await readdir(join(root, 'agents/qa-agent/sessions'));
  const resumed = await host.launch({ projectId, agentId: agent.id, autoContinue: false });
  assert.equal(resumed.project.agents[0].session?.path, binding.path);
  assert.equal(await children[1], 0);
  assert.equal(
    await readFile(join(root, binding.path), 'utf8'),
    transcript,
    'Resume must not add any user message or replay generation',
  );
  assert.deepEqual(await readdir(join(root, 'agents/qa-agent/sessions')), beforeFiles);
  for (const id of [started.runId, resumed.runId]) {
    const context = await readFile(join(root, '.pistudio/context', id, 'context.json'), 'utf8');
    assert.equal(context.includes(agent.mainInstruction!), false);
    assert.equal(context.includes('PISTUDIO_REAL_SESSION_OK'), false);
  }
  console.log(
    'Real Pi session passed: selected subscription model, native MCP, actual output, explicit validated completion, exact resume without a message, no instruction/prompt copies in run contexts.',
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(temporary, { recursive: true, force: true });
}
