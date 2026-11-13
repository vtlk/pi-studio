import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-live-current-model-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const initial: Agent = {
  id: 'qa-current-model-agent',
  name: 'QA current scenario',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  mainInstruction: 'CURRENT_MODEL_TEST_INSTRUCTION: follow the current explicit user task.',
  model: { connectionId: 'qa', provider: 'openai-codex', id: '', reasoning: '', temperature: '' },
};
await store.saveSection('agents', [initial]);
await store.saveSection('connections', [
  {
    id: 'qa',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const first = (await store.command({ kind: 'create', name: 'Selected project', agents: [initial] }))
  .projects[0];
const second = (
  await store.command({ kind: 'create', name: 'Untouched project', agents: [initial] })
).projects.find((project) => project.id !== first.id)!;
const firstFile = join(await store.projects.directory(first.id), 'project.json'),
  secondFile = join(await store.projects.directory(second.id), 'project.json');
const initialBytes = await readFile(firstFile, 'utf8'),
  otherBytes = await readFile(secondFile, 'utf8');
const configured: Agent = {
  ...initial,
  model: { ...initial.model!, id: 'gpt-5.6-luna', reasoning: 'Средний' },
};
await store.saveSection('agents', [configured]);
assert.equal(
  await readFile(firstFile, 'utf8'),
  initialBytes,
  'Editing a constructor model does not mutate projects or start work.',
);
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
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
  const request = { projectId: first.id, agentId: initial.id, autoContinue: false };
  const launched = await host.launch({
    ...request,
    firstMessage:
      'This is an isolated launch regression test. Call get_run_context. Use native bash/write to save its model and projectRoot fields unchanged to output/model.json, then call complete_stage with model.json. Do not ask questions or use external generation. Finish with a short confirmation.',
  });
  assert.equal(await children[0], 0);
  let project = await store.projects.read(first.id);
  assert.equal(project.agents[0].profile.model?.id, 'gpt-5.6-luna');
  assert.equal(project.agents[0].runStatus, 'ready');
  const directory = await store.projects.directory(first.id);
  const proof = JSON.parse(
    await readFile(join(directory, project.agents[0].outputPath, 'model.json'), 'utf8'),
  );
  assert.equal(proof.model.id, 'gpt-5.6-luna');
  assert.equal(proof.model.connectionId, 'qa');
  assert.equal(proof.projectRoot, directory);
  assert.equal(await readFile(secondFile, 'utf8'), otherBytes);
  assert.equal(
    (await readFile(firstFile, 'utf8')).includes('CURRENT_MODEL_TEST_INSTRUCTION'),
    false,
  );
  const session = project.agents[0].session!;
  const transcript = await readFile(join(directory, session.path), 'utf8');
  const messages = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((item) => item.type === 'message')
      .map((item) => item.message);
  assert.equal(messages(transcript).filter((message) => message.role === 'user').length, 1);
  assert.ok(
    messages(transcript).some(
      (message) => message.role === 'assistant' && message.model === 'gpt-5.6-luna',
    ),
  );
  const outputBytes = await readFile(
    join(directory, project.agents[0].outputPath, 'model.json'),
    'utf8',
  );
  await store.saveSection('agents', [
    { ...configured, model: { ...configured.model!, reasoning: 'Высокий' } },
  ]);
  const resumed = await host.launch(request);
  assert.equal(await children[1], 0);
  project = await store.projects.read(first.id);
  assert.equal(project.agents[0].session?.path, session.path);
  assert.equal(project.agents[0].profile.model?.reasoning, 'Высокий');
  const context = JSON.parse(
    await readFile(join(directory, '.pistudio/context', resumed.runId, 'context.json'), 'utf8'),
  );
  assert.equal(context.model.reasoning, 'Высокий');
  assert.equal(context.model.id, 'gpt-5.6-luna');
  assert.equal(
    messages(await readFile(join(directory, session.path), 'utf8')).length,
    messages(transcript).length,
    'Idle resume changes no user/assistant messages and does not replay the task.',
  );
  assert.equal(
    await readFile(join(directory, project.agents[0].outputPath, 'model.json'), 'utf8'),
    outputBytes,
  );
  await store.saveSection('agents', [
    { ...configured, model: { ...configured.model!, reasoning: '' } },
  ]);
  await assert.rejects(() => host.launch(request), /уровень рассуждения/);
  assert.equal(children.length, 2);
  assert.equal(await readFile(secondFile, 'utf8'), otherBytes);
  console.log(
    'Real current-model launch passed: an old empty project snapshot uses the newly configured GPT-5.6 Luna/connection/effort, actual model writes validated output, only the selected project updates; exact idle resume applies current effort without replay, missing effort opens no Pi.',
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
