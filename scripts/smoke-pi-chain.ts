import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';

// Opt-in: two actual subscription requests, automatic handoff, a disabled stage and idle resume.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-chain-'));
const base: Agent = {
  id: 'first',
  name: 'First',
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  mainInstruction:
    'Write output/first.txt containing CHAIN_FIRST_OK then signal complete_stage with first.txt. Do not ask questions or do extra work.',
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
};
const agents = [
  base,
  { ...base, id: 'skip', enabled: false },
  {
    ...base,
    id: 'last',
    name: 'Last',
    mainInstruction:
      'Read ../first/output/first.txt. If it contains CHAIN_FIRST_OK write output/final.txt containing CHAIN_FINAL_OK and a newline. Signal complete_stage with final.txt. No questions or extra work.',
  },
];
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
await store.saveSection('agents', agents);
await store.saveSection('connections', [
  {
    id: 'subscription',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const project = (await store.command({ kind: 'create', name: 'Real chain', agents })).projects[0];
// A pre-refinement project must not retain the obsolete mandatory-approval block.
const projectFile = join(await store.projects.directory(project.id), 'project.json');
const legacy = JSON.parse(await readFile(projectFile, 'utf8'));
legacy.agents[0].profile.requiresSceneApproval = true;
await writeFile(projectFile, JSON.stringify(legacy));
const pi = await checkPi('');
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  headless: true,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
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
    agentId: 'first',
    firstMessage: 'Execute your role for this chain test.',
    autoContinue: true,
  });
  for (let i = 0; i < 1800; i++) {
    const current = await store.projects.read(project.id);
    if (current.agents[2].runStatus === 'ready') break;
    if (current.agents.some((agent) => agent.runStatus === 'error'))
      throw new Error('A real chain stage failed');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finished = await store.projects.read(project.id);
  assert.equal(finished.agents[0].runStatus, 'ready');
  assert.equal(finished.agents[2].runStatus, 'ready');
  assert.equal(finished.agents[1].session, undefined);
  assert.equal(children.length, 2);
  await Promise.all([...children]);
  const directory = await store.projects.directory(project.id);
  assert.equal(
    await readFile(join(directory, 'agents/last/output/final.txt'), 'utf8'),
    'CHAIN_FINAL_OK\n',
  );
  const transcripts = await Promise.all(
    [0, 2].map((index) => readFile(join(directory, finished.agents[index].session!.path), 'utf8')),
  );
  await host.launch({ projectId: project.id, agentId: 'first', autoContinue: true });
  await children[2];
  assert.equal(
    children.length,
    3,
    'Idle resume with continuation armed must not launch another stage',
  );
  assert.deepEqual(
    await Promise.all(
      [0, 2].map((index) =>
        readFile(join(directory, finished.agents[index].session!.path), 'utf8'),
      ),
    ),
    transcripts,
  );
  console.log(
    'Production factory chain passed: legacy approval flag ignored, two real selected Pi stages, disabled-stage skip, fresh contexts, native MCP completion and no replay on an armed idle resume. No user studio changed.',
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
