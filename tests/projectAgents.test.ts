import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import type { Agent } from '../src/shared/studio.ts';

const profile = (id: string, enabled = true): Agent => ({
  id,
  name: `Custom ${id}`,
  enabled,
  instructions: [
    { id: 'block', name: 'Current', content: 'Do not snapshot this text', enabled: true },
  ],
  mainInstruction: 'Current constructor instruction',
  skills: ['user-skill'],
  mcps: ['pistudio-project', 'user-mcp'],
  plugins: ['user-package'],
  capabilitySettings: { 'mcps:user-mcp': { enabled: false } },
  model: {
    connectionId: 'user-account',
    provider: 'user-provider',
    id: 'user-model',
    reasoning: 'Высокий',
    temperature: '',
  },
});
const settings = ({ instructions: _blocks, mainInstruction: _text, ...value }: Agent) => value;
test('new projects copy exactly the current constructor IDs/order/enabled/model/resources, never fixture roles or instruction text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-constructor-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const constructor = [
    profile('custom-third'),
    profile('custom-first', false),
    profile('custom-second'),
  ];
  await store.saveSection('agents', constructor);
  const first = (
    await store.command({
      kind: 'create',
      name: 'One',
      agents: store.bootstrap().sections.agents as Agent[],
    })
  ).projects[0];
  assert.deepEqual(
    first.agents.map((agent) => agent.profile),
    constructor.map(settings),
  );
  assert.deepEqual(
    first.agents.map((agent) => agent.outputPath),
    constructor.map((agent) => `agents/${agent.name.toLowerCase().replaceAll(' ', '-')}/output`),
  );
  const changed = [
    {
      ...constructor[2],
      name: 'Edited now',
      model: { ...constructor[2].model!, id: 'different-model' },
    },
    constructor[0],
  ];
  await store.saveSection('agents', changed);
  const second = (
    await store.command({
      kind: 'create',
      name: 'Two',
      agents: store.bootstrap().sections.agents as Agent[],
    })
  ).projects.find((project) => project.name === 'Two')!;
  assert.deepEqual(
    second.agents.map((agent) => agent.profile),
    changed.map(settings),
  );
  assert.deepEqual(
    (await store.projects.read(first.id)).agents.map((agent) => agent.profile),
    constructor.map(settings),
  );
  assert.equal(
    (await readFile(join(root, 'projects/one/project.json'), 'utf8')).includes(
      'Current constructor instruction',
    ),
    false,
  );
});
test('removing a project agent is persistent and reversible; output/session bytes and constructor stay intact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-project-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = await StudioStore.open(root);
  const constructor = [profile('a'), profile('b'), profile('c', false)];
  await store.saveSection('agents', constructor);
  const project = (await store.command({ kind: 'create', name: 'Movie', agents: constructor }))
    .projects[0];
  const output = join(root, 'projects/movie/agents/custom-b/output/result.txt');
  await writeFile(output, 'Real output preserved');
  const sessionPath = '.pistudio/sessions/b/dialogue.jsonl';
  await writeFile(join(root, 'projects/movie', sessionPath), 'canonical Pi history');
  await store.projects.updateRuntime(project.id, 'b', 'waiting', {
    id: 'dialogue',
    title: 'Bound',
    path: sessionPath,
    createdAt: 1,
  });
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'b' });
  assert.deepEqual(
    (await store.projects.read(project.id)).agents.map((item) => item.profile.id),
    ['a', 'c'],
  );
  assert.deepEqual(store.bootstrap().sections.agents, constructor);
  store = await StudioStore.open(root);
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: constructor,
    updateExisting: true,
  });
  assert.deepEqual(
    (await store.projects.read(project.id)).agents.map((item) => item.profile.id),
    ['a', 'b', 'c'],
    'Confirmed synchronization restores an agent that still exists in the global constructor',
  );
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'b' });
  await store.command({ kind: 'restore-agent', projectId: project.id, agentId: 'b' });
  const restored = await store.projects.read(project.id);
  assert.deepEqual(
    restored.agents.map((item) => item.profile.id),
    ['a', 'b', 'c'],
  );
  assert.equal(restored.agents[1].session?.path, sessionPath);
  assert.equal(await readFile(output, 'utf8'), 'Real output preserved');
  assert.equal(
    await readFile(join(root, 'projects/movie', sessionPath), 'utf8'),
    'canonical Pi history',
  );
  for (const agent of constructor)
    await store.command({ kind: 'remove-agent', projectId: project.id, agentId: agent.id });
  assert.deepEqual((await store.projects.read(project.id)).agents, []);
  await assert.rejects(
    store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'absent' }),
  );
});
