import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { parseAgentCatalog } from '../src/main/storage/validation.ts';
import type { Agent } from '../src/shared/studio.ts';
import { teamAgents } from '../src/shared/agentTeams.ts';

const agent = (id: string): Agent => ({
  id,
  name: id,
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  mainInstruction: 'Current role ' + id,
  instructions: [
    { id: 'rule-' + id, name: 'Rule', content: 'Current instruction ' + id, enabled: true },
  ],
});

test('new native studios persist no teams or ordinary agents, including after reopen and an explicit empty save', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-no-bundled-teams-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let pass = 0; pass < 3; pass++) {
    const store = await StudioStore.open(root);
    const bootstrap = store.bootstrap();
    assert.deepEqual(store.agentCatalog(), { agents: [], teams: [] });
    assert.deepEqual(bootstrap.sections.agentTeams, []);
    assert.deepEqual(bootstrap.sections.agents, []);
    assert.deepEqual(bootstrap.projects, []);
    assert.deepEqual(bootstrap.trashProjects, []);
    const system = bootstrap.sections.systemAgents as Agent[];
    assert.equal(system.length, 1);
    assert.equal(system[0].systemRole, 'assistant');
    if (pass === 1) await store.saveSection('agentCatalog', { agents: [], teams: [] });
    const persisted = JSON.parse(await readFile(join(root, '.pistudio/studio.json'), 'utf8'));
    assert.deepEqual(persisted.sections.agentTeams, []);
    assert.deepEqual(persisted.sections.agents, []);
  }
});

test('legacy projects with no remaining constructor profiles get a stable empty source team; a fresh studio stays empty', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-empty-legacy-team-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  assert.deepEqual(store.agentCatalog().teams, []);
  const project = (await store.command({ kind: 'create', name: 'Empty legacy', agents: [] }))
    .projects[0];
  const file = join(root, '.pistudio/studio.json'),
    document = JSON.parse(await readFile(file, 'utf8'));
  delete document.sections.agentTeams;
  await writeFile(file, JSON.stringify(document));
  const migrated = await StudioStore.open(root),
    team = migrated.agentCatalog().teams[0];
  assert.equal(team.name, 'Моя команда');
  assert.deepEqual(team.agentIds, []);
  assert.equal((await migrated.projects.read(project.id)).sourceTeamId, team.id);
  const reopened = await StudioStore.open(root);
  assert.deepEqual(reopened.agentCatalog().teams, [team]);
});

test('legacy team migration preserves exact IDs, order, paths, output and canonical dialogue; restart is idempotent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-teams-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const profiles = [agent('two'), agent('one')];
  await store.saveSection('agents', profiles);
  const project = (await store.command({ kind: 'create', name: 'Legacy', agents: profiles }))
    .projects[0];
  const path = await store.projects.directory(project.id);
  const output = join(path, project.agents[0].outputPath, 'result.md');
  const session = join(path, '.pistudio/sessions/two/dialogue.jsonl');
  await writeFile(output, 'Keep output bytes');
  await writeFile(session, 'Keep canonical dialogue');
  const file = join(root, '.pistudio/studio.json');
  const document = JSON.parse(await readFile(file, 'utf8'));
  delete document.sections.agentTeams;
  await writeFile(file, JSON.stringify(document));
  const migrated = await StudioStore.open(root);
  const catalog = migrated.agentCatalog();
  assert.equal(catalog.teams.length, 1);
  assert.deepEqual(catalog.teams[0].agentIds, ['two', 'one']);
  assert.deepEqual(
    catalog.agents,
    parseAgentCatalog({ agents: profiles, teams: catalog.teams }).agents,
  );
  assert.equal(migrated.bootstrap().projects[0].sourceTeamId, catalog.teams[0].id);
  assert.deepEqual(migrated.bootstrap().projects[0].agents, project.agents);
  assert.equal(await readFile(output, 'utf8'), 'Keep output bytes');
  assert.equal(await readFile(session, 'utf8'), 'Keep canonical dialogue');
  const bytes = await readFile(file, 'utf8');
  const projectBytes = await readFile(join(path, 'project.json'), 'utf8');
  const again = await StudioStore.open(root);
  assert.deepEqual(again.agentCatalog(), catalog);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal(await readFile(join(path, 'project.json'), 'utf8'), projectBytes);
  assert.equal(
    bytes.includes('agentCatalog'),
    false,
    'virtual save section never duplicates instructions on disk',
  );
});

test('team catalog is atomic and rejects duplicate/foreign/missing membership, system profiles and stale edits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-teams-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  assert.deepEqual(store.agentCatalog(), { agents: [], teams: [] });
  const catalog = {
    agents: [agent('a'), agent('b')],
    teams: [
      { id: 'first', name: 'First', agentIds: ['a'] },
      { id: 'second', name: 'Second', agentIds: ['b'] },
    ],
  };
  await store.saveSection('agentCatalog', catalog);
  const bytes = await readFile(join(root, '.pistudio/studio.json'), 'utf8');
  for (const teams of [
    [{ id: 'first', name: 'First', agentIds: ['a', 'a'] }],
    [{ id: 'first', name: 'First', agentIds: ['a', 'missing'] }],
    [{ id: 'first', name: 'First', agentIds: ['a'] }],
  ]) {
    await assert.rejects(store.saveSection('agentCatalog', { ...catalog, teams }));
    assert.equal(await readFile(join(root, '.pistudio/studio.json'), 'utf8'), bytes);
  }
  assert.throws(() =>
    parseAgentCatalog({ agents: [], teams: [{ id: 'x', name: ' ', agentIds: [] }] }),
  );
  const helper = (store.bootstrap().sections.systemAgents as Agent[])[0];
  await assert.rejects(
    store.addImportedTeam(
      { id: 'imported-system', name: 'Invalid', agentIds: [helper.id] },
      [helper],
      [],
    ),
    /Системный помощник/,
  );
  await assert.rejects(
    store.saveSection('agentCatalog', {
      agents: [helper],
      teams: [{ id: 'x', name: 'X', agentIds: [helper.id] }],
    }),
    /помощник/,
  );
  const changed = {
    ...catalog,
    teams: catalog.teams.map((team) => ({ ...team, name: team.name + ' edit' })),
  };
  await store.saveSection('agentCatalog', changed);
  const result = await store.editSection('agentCatalog', catalog, {
    folder: store.folder,
    base: catalog,
  });
  assert.equal(result.saved, false);
  assert.deepEqual(result.value, parseAgentCatalog(changed));
});

test('project create, refresh, clone, rename and missing source remain scoped to the exact team; histories and snapshot settings survive', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-teams-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const catalog = {
    agents: [agent('a'), agent('b')],
    teams: [
      { id: 'first', name: 'First', agentIds: ['a'] },
      { id: 'second', name: 'Second', agentIds: ['b'] },
    ],
  };
  await store.saveSection('agentCatalog', catalog);
  await assert.rejects(
    store.command({ kind: 'create', name: 'Wrong', teamId: 'first', agents: [agent('b')] }),
    /Состав команды/,
  );
  const project = (
    await store.command({
      kind: 'create',
      name: 'One',
      teamId: 'first',
      agents: teamAgents(catalog, 'first'),
    })
  ).projects[0];
  assert.equal(project.sourceTeamId, 'first');
  assert.deepEqual(
    project.agents.map((agent) => agent.profile.id),
    ['a'],
  );
  const path = await store.projects.directory(project.id);
  await writeFile(join(path, project.agents[0].outputPath, 'keep.txt'), 'keep');
  const cloneId = (await store.command({ kind: 'clone', projectId: project.id, name: 'Copy' }))
    .selectedId!;
  assert.equal((await store.projects.read(cloneId)).sourceTeamId, 'first');
  await store.command({ kind: 'rename', projectId: project.id, name: 'Renamed' });
  assert.equal((await store.projects.read(project.id)).sourceTeamId, 'first');
  await assert.rejects(
    store.command({
      kind: 'update-agents',
      projectId: project.id,
      agents: [agent('b')],
      updateExisting: true,
    }),
    /исходной команды/,
  );
  await store.saveSection('agentCatalog', { agents: [agent('b')], teams: [catalog.teams[1]] });
  await assert.rejects(
    store.command({
      kind: 'update-agents',
      projectId: project.id,
      agents: [],
      updateExisting: true,
    }),
    /команда.*отсутствует/,
  );
  const kept = await store.projects.read(project.id);
  assert.deepEqual(
    kept.agents.map((agent) => agent.profile.id),
    ['a'],
  );
  assert.equal(
    await readFile(
      join(await store.projects.directory(project.id), kept.agents[0].outputPath, 'keep.txt'),
      'utf8',
    ),
    'keep',
  );
});

test('cross-team copy deeply preserves the full profile and assignments; move preserves identity, order and unrelated teams', async () => {
  const { transferTeamAgent } = await import('../src/shared/agentTeams.ts');
  const a = {
    ...agent('a'),
    enabled: false,
    skills: ['skill'],
    mcps: ['pistudio-project', 'pistudio-team'],
    plugins: ['plugin'],
    capabilitySettings: { 'pistudio-team': { enabled: false } },
    model: {
      connectionId: 'connection',
      provider: 'provider',
      id: 'model',
      reasoning: 'high',
      temperature: '0.5',
    },
  };
  const catalog = {
    agents: [a, agent('b'), agent('c')],
    teams: [
      { id: 'source', name: 'Source', agentIds: ['a', 'b'] },
      { id: 'target', name: 'Target', agentIds: ['c'] },
    ],
  };
  const original = structuredClone(catalog);
  const copied = transferTeamAgent(catalog, 'a', 'source', 'target', 'copy');
  assert.deepEqual(catalog, original, 'No optimistic move or mutation of source data');
  assert.deepEqual(
    copied.teams.map((t) => t.agentIds),
    [
      ['a', 'b'],
      ['c', 'copy'],
    ],
  );
  const clone = copied.agents.find((a) => a.id === 'copy')!;
  assert.deepEqual(clone, { ...a, id: 'copy' });
  clone.instructions[0].content = 'independent';
  clone.capabilitySettings!['pistudio-team'].enabled = true;
  assert.equal(a.instructions[0].content, 'Current instruction a');
  assert.equal(a.capabilitySettings['pistudio-team'].enabled, false);
  assert.equal(parseAgentCatalog(copied).agents.length, 4);
  const moved = transferTeamAgent(catalog, 'a', 'source', 'target');
  assert.deepEqual(
    moved.teams.map((t) => t.agentIds),
    [['b'], ['c', 'a']],
  );
  assert.equal(
    moved.agents.find((item) => item.id === 'a'),
    a,
    'Move keeps stable identity and settings',
  );
  assert.equal(moved.agents.length, 3);
  assert.equal(
    transferTeamAgent(catalog, 'a', 'target', 'source'),
    catalog,
    'Stale source is rejected',
  );
  assert.equal(transferTeamAgent(catalog, 'a', 'source', 'missing'), catalog);
  assert.equal(transferTeamAgent(catalog, 'a', 'source', 'source'), catalog);
  assert.equal(
    transferTeamAgent(catalog, 'a', 'source', 'target', 'b'),
    catalog,
    'Copy cannot overwrite another profile',
  );
});

test('cross-team insertion uses the stable destination row and preserves order for copy, move and header append', async () => {
  const { transferTeamAgent } = await import('../src/shared/agentTeams.ts');
  const catalog = {
    agents: [agent('a'), agent('b'), agent('c')],
    teams: [
      { id: 'source', name: 'Source', agentIds: ['a'] },
      { id: 'target', name: 'Target', agentIds: ['b', 'c'] },
    ],
  };
  const copied = transferTeamAgent(catalog, 'a', 'source', 'target', 'copy', 'b');
  assert.deepEqual(
    copied.teams.map((t) => t.agentIds),
    [['a'], ['copy', 'b', 'c']],
  );
  const moved = transferTeamAgent(catalog, 'a', 'source', 'target', undefined, 'c');
  assert.deepEqual(
    moved.teams.map((t) => t.agentIds),
    [[], ['b', 'a', 'c']],
  );
  assert.equal(
    moved.agents.find((a) => a.id === 'a'),
    catalog.agents[0],
  );
  assert.deepEqual(transferTeamAgent(catalog, 'a', 'source', 'target').teams[1].agentIds, [
    'b',
    'c',
    'a',
  ]);
  assert.equal(
    transferTeamAgent(catalog, 'a', 'source', 'target', undefined, 'removed-row'),
    catalog,
    'A stale confirmed target must not silently append elsewhere',
  );
  assert.deepEqual(
    catalog.teams.map((t) => t.agentIds),
    [['a'], ['b', 'c']],
  );
});
