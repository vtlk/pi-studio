import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { parseProject, projectDocument } from '../src/main/storage/validation.ts';
import { agentDirectory, agentFolderSlug } from '../src/shared/agentPaths.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';

const agent = (name: string): Agent => ({
  id: randomUUID(),
  name,
  enabled: true,
  mainInstruction: 'Current role',
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    provider: 'provider',
    connectionId: 'connection',
    id: 'model',
    reasoning: 'low',
    temperature: '',
  },
});
test('agent folder slugs use the title, not the UUID or a fixed production role', () => {
  assert.equal(agentFolderSlug('Сценарий и раскадровка'), 'scenariy-i-raskadrovka');
  assert.equal(agentFolderSlug(' Café / 🎥 Звук & музыка! '), 'cafe-zvuk-muzyka');
  assert.equal(agentFolderSlug('... / 🚀'), 'agent');
  for (const path of [
    'agents/../output',
    'agents/a/b/output',
    '/agents/name/output',
    'agents/name/output/',
    'agents/name/../output',
  ])
    assert.throws(() => agentDirectory(path));
});

test('readable folders survive rename, refresh, deletion/restore and clone; new duplicate names use free suffixes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-agent-folders-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = await StudioStore.open(root);
  const profiles = [
    agent('Сценарий и раскадровка'),
    agent('Персонажи'),
    agent('ПЕРСОНАЖИ'),
    agent('🚀'),
  ];
  const project = (await store.command({ kind: 'create', name: 'Movie', agents: profiles }))
    .projects[0];
  const paths = ['scenariy-i-raskadrovka', 'personazhi', 'personazhi-2', 'agent'].map(
    (slug) => `agents/${slug}/output`,
  );
  assert.deepEqual(
    project.agents.map((item) => item.outputPath),
    paths,
  );
  assert.deepEqual(
    project.agents.map((item) => item.profile.id),
    profiles.map((item) => item.id),
  );
  const directory = await store.projects.directory(project.id);
  await writeFile(join(directory, paths[0], 'script.md'), 'Preserve output');
  const sessionPath = `${agentDirectory(paths[0])}/sessions/dialogue.jsonl`;
  await writeFile(join(directory, sessionPath), 'Preserve transcript');
  await store.projects.updateRuntime(project.id, profiles[0].id, 'waiting', {
    id: 'dialogue',
    title: 'Dialogue',
    path: sessionPath,
    createdAt: 1,
  });
  const renamed = { ...profiles[0], name: 'Совсем другая задача' };
  await mkdir(join(directory, 'agents/personazhi-3')); // A pre-existing unindexed folder must not be reused.
  const extra = agent('Персонажи');
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: [extra, renamed, ...profiles.slice(1)],
    updateExisting: true,
  });
  const updated = await store.projects.read(project.id);
  assert.equal(updated.agents[0].outputPath, 'agents/personazhi-4/output');
  assert.equal(updated.agents[1].profile.name, renamed.name);
  assert.equal(updated.agents[1].outputPath, paths[0]);
  const run = await buildRunContext(
    directory,
    updated,
    profiles[1].id,
    [extra, renamed, ...profiles.slice(1)],
    [],
  );
  assert.equal(run.record.cwd, join(directory, 'agents/personazhi'));
  assert.equal(run.record.sessionDirectory, join(directory, 'agents/personazhi/sessions'));
  assert.deepEqual(run.record.previousOutputs[1], {
    agentId: renamed.id,
    agentName: renamed.name,
    path: join(directory, paths[0]),
  });
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: profiles[0].id });
  store = await StudioStore.open(root);
  await store.command({ kind: 'restore-agent', projectId: project.id, agentId: profiles[0].id });
  const restored = await store.projects.read(project.id);
  assert.equal(restored.agents[1].session?.path, sessionPath);
  const copy = (
    await store.command({ kind: 'clone', projectId: project.id, name: 'Copy' })
  ).projects.find((item) => item.name === 'Copy')!;
  assert.deepEqual(
    copy.agents.map((item) => item.outputPath),
    restored.agents.map((item) => item.outputPath),
  );
  assert.equal(
    await readFile(join(await store.projects.directory(copy.id), paths[0], 'script.md'), 'utf8'),
    'Preserve output',
  );
  assert.equal(await readFile(join(directory, sessionPath), 'utf8'), 'Preserve transcript');
  assert.equal(copy.agents[1].session?.needsFork, true);
  const duplicate = projectDocument(restored);
  duplicate.agents[0].outputPath = duplicate.agents[1].outputPath
    .toUpperCase()
    .replace('AGENTS/', 'agents/')
    .replace('/OUTPUT', '/output');
  assert.throws(() => parseProject(duplicate), /Повторяющиеся папки/);
});

test('legacy ID folders and exact session bindings load without migration; an empty project accepts new agents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-agent-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const project = (await store.command({ kind: 'create', name: 'Empty', agents: [] })).projects[0];
  const directory = await store.projects.directory(project.id);
  const profile = agent('Новая задача');
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: [profile],
    updateExisting: false,
  });
  assert.ok((await stat(join(directory, 'agents/novaya-zadacha/output'))).isDirectory());
  const legacy = projectDocument(await store.projects.read(project.id));
  legacy.agents[0].outputPath = 'agents/writer/output';
  legacy.agents[0].session = {
    id: 'one',
    path: 'agents/writer/sessions/one.jsonl',
    createdAt: 1,
    title: 'Existing',
  };
  const parsed = parseProject(legacy);
  assert.equal(parsed.agents[0].outputPath, 'agents/writer/output');
  assert.equal(parsed.agents[0].session?.path, 'agents/writer/sessions/one.jsonl');
  legacy.agents[0].session.path = 'agents/someone-else/sessions/one.jsonl';
  assert.throws(() => parseProject(legacy), /путь сессии/);
});
