import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';
import { createSystemAgents } from '../src/shared/systemAgents.ts';
import { libraryMcpId } from '../src/shared/builtinResources.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { libraryTool } from '../src/main/library/tools.ts';
import { createLibraryRunHost } from '../src/main/pi/createLibraryRunHost.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { saveManagedSkill } from '../src/main/storage/managedSkills.ts';
import { inspectSkill } from '../src/main/storage/skills.ts';

const profile = (id: string): Agent => ({
  id,
  name: id,
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'Низкий', temperature: '' },
});

test('legacy creators become ordinary profiles once, preserving IDs, current text, helper and job histories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-migrate-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const helper = createSystemAgents(() => 'original-helper')[0];
  const creators = ['character', 'location'].map((systemRole, index) => ({
    ...profile(`creator-${index}`),
    systemRole,
    mainInstruction: `Сохранённый текст ${index}`,
    skills: [`custom-${index}`],
  }));
  const sections = {
    ...store.bootstrap().sections,
    agents: [profile('story')],
    systemAgents: [...creators, helper],
  };
  const settings = join(root, '.pistudio/studio.json');
  await writeFile(settings, JSON.stringify({ schemaVersion: 1, sections }));
  const history = join(root, '.pistudio/library-runs/job/agents/creator-0/sessions/dialogue.jsonl');
  await mkdir(join(history, '..'), { recursive: true });
  await writeFile(history, '{"type":"session","id":"original"}\n');
  const before = await readFile(history);
  const migrated = await StudioStore.open(root);
  const state = migrated.bootstrap().sections;
  assert.deepEqual(state.systemAgents, [helper]);
  const agents = state.agents as Agent[];
  assert.deepEqual(
    agents.map((item) => item.id),
    ['story', 'creator-0', 'creator-1'],
  );
  for (const [index, agent] of agents.slice(1).entries()) {
    assert.equal(agent.mainInstruction, creators[index].mainInstruction);
    assert.deepEqual(agent.skills, creators[index].skills);
    assert.deepEqual(agent.model, creators[index].model);
    assert.ok(agent.mcps.includes(libraryMcpId));
    assert.equal('systemRole' in agent, false);
  }
  assert.deepEqual(state.libraryAgents, { characters: 'creator-0', locations: 'creator-1' });
  assert.deepEqual(await readFile(history), before);
  const bytes = await readFile(settings);
  await StudioStore.open(root);
  assert.deepEqual(await readFile(settings), bytes);
  assert.deepEqual(await readFile(history), before);
  assert.deepEqual(migrated.bootstrap().projects, []);
});

test('library capability follows explicit current assignment, including revocation from an already opened run', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-library-grant-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const original = profile('artist');
  await store.saveSection('agents', [original]);
  const project = (await store.command({ kind: 'create', name: 'Movie', agents: [original] }))
    .projects[0];
  const directory = await store.projects.directory(project.id);
  const build = (agent: Agent) => buildRunContext(directory, project, agent.id, [agent], []);
  assert.equal((await build(original)).libraryAccess, false);
  const assigned = { ...original, mcps: [libraryMcpId] };
  await store.saveSection('agents', [assigned]);
  const granted = await build(assigned);
  assert.equal(granted.libraryAccess, true);
  assert.deepEqual(
    granted.resources.mcpServers,
    [],
    'Built-in tools are not an external/native server',
  );
  assert.deepEqual(granted.record.resourceIds.mcps, [libraryMcpId]);
  await libraryTool(service, granted, 'library_get_contract', {});
  const disabled = {
    ...assigned,
    capabilitySettings: { [`mcps:${libraryMcpId}`]: { enabled: false } },
  };
  await store.saveSection('agents', [disabled]);
  await assert.rejects(
    () => libraryTool(service, granted, 'library_get_contract', {}),
    /не назначен.*выключен/,
  );
  assert.equal((await build(disabled)).libraryAccess, false);
  await store.saveSection('agents', [original]);
  assert.equal((await build(original)).libraryAccess, false);
  await assert.rejects(() => libraryTool(service, granted, 'library_get_contract', {}));
  assert.deepEqual(
    (await store.projects.read(project.id)).agents[0].profile.mcps,
    [],
    'No project snapshot changes on constructor edit',
  );
});

test('library launch rejects absent, disabled and unassigned profiles before files or a replacement session', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-library-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const host = createLibraryRunHost(service, {
    bootstraps: join(root, 'boots'),
    bridge: '/unused',
    catalog: '/unused',
    piPath: () => '/unused',
    references: new ReferenceFiles(),
    openTerminal: async () => {
      throw new Error('Must not open');
    },
  });
  t.after(() => host.close());
  const assigned = { ...profile('artist'), mcps: [libraryMcpId] };
  for (const agents of [[], [profile('artist')], [{ ...assigned, enabled: false }]]) {
    await store.saveSection('agents', agents);
    for (const kind of ['characters', 'locations'] as const)
      await assert.rejects(
        () => host.create({ agentId: 'artist', kind, description: 'Create', attachments: [] }),
        /агент отсутствует.*выключен/,
      );
  }
  await store.saveSection('libraryAgents', { characters: 'missing', locations: 'artist' });
  assert.deepEqual((await StudioStore.open(store.folder)).bootstrap().sections.libraryAgents, {
    characters: 'missing',
    locations: 'artist',
  });
  await assert.rejects(readdir(join(store.folder, '.pistudio/library-runs')));
  assert.deepEqual(store.bootstrap().projects, []);
});

test('managed skills share one current file and reject stale edits, duplicate names and writes into another studio', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-shared-skill-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const request = {
    folder: store.folder,
    name: 'create-library-art',
    description: 'Create requested artwork',
    content: 'Первая общая инструкция',
  };
  const resource = await saveManagedSkill(store, request);
  const old = await inspectSkill(resource.source);
  const agents = ['a', 'b'].map((id) => ({ ...profile(id), skills: [resource.id] }));
  await store.saveSection('agents', agents);
  const project = (await store.command({ kind: 'create', name: 'Skills', agents })).projects[0];
  const newer = await saveManagedSkill(store, {
    ...request,
    id: resource.id,
    previousContent: old.content,
    content: 'Актуальная общая инструкция',
  });
  assert.equal(newer.source, resource.source);
  for (const agent of agents) {
    const run = await buildRunContext(
      await store.projects.directory(project.id),
      project,
      agent.id,
      agents,
      store.bootstrap().sections.resources as Resource[],
    );
    assert.deepEqual(
      run.resources.skills.map((item) => item.path),
      [resource.source],
    );
    const record = await readFile(
      join(run.projectRoot, '.pistudio/context', run.record.runId, 'context.json'),
      'utf8',
    );
    assert.ok(!record.includes('общая инструкция'));
  }
  const current = await inspectSkill(resource.source);
  assert.match(current.content, /Актуальная/);
  await assert.rejects(
    () =>
      saveManagedSkill(store, {
        ...request,
        id: resource.id,
        previousContent: old.content,
        content: 'Lost update',
      }),
    /изменён/,
  );
  await assert.rejects(
    () => saveManagedSkill(store, { ...request, folder: '/another/studio' }),
    /Папка/,
  );
  await assert.rejects(() => saveManagedSkill(store, request), /уже существует/);
  assert.equal((await inspectSkill(resource.source)).content, current.content);
  assert.equal((store.bootstrap().sections.resources as Resource[]).length, 1);
});
