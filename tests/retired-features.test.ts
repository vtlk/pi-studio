import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retireLegacyFeatures,
  withoutRetiredResources,
  retiredBuiltin,
} from '../src/main/storage/retireLegacyFeatures.ts';
import { parseStudio } from '../src/main/storage/validation.ts';
import { createSystemAgents } from '../src/shared/systemAgents.ts';
import type { Agent } from '../src/shared/studio.ts';
const obsolete = 'pistudio-library';
const profile = (id: string): Agent => ({
  id,
  name: 'User ' + id,
  enabled: true,
  instructions: [
    {
      id: 'instruction-' + id,
      name: 'Keep',
      content: 'Unchanged user instructions',
      enabled: true,
    },
  ],
  mainInstruction: 'Unchanged current prompt',
  skills: ['assigned-skill'],
  plugins: ['assigned-package'],
  mcps: [obsolete, 'custom-mcp'],
  model: {
    connectionId: 'account',
    provider: 'test',
    id: 'model',
    reasoning: 'high',
    temperature: '',
  },
  capabilitySettings: {
    ['mcps:' + obsolete]: { enabled: false },
    'mcps:custom-mcp': { enabled: true },
  },
});
const resource = (id: string, source: string) => ({
  id,
  source,
  kind: 'mcps',
  name: 'Resource',
  version: '1',
  description: 'Keep custom text',
  transport: 'HTTP',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
});
test('fresh and already-normalized catalogs create no teams, profiles or retired settings', () => {
  const raw = { schemaVersion: 1, sections: {} };
  let ids = 0;
  const clean = retireLegacyFeatures(raw, () => {
    ids++;
    return 'unused';
  });
  assert.equal(clean.document, raw);
  assert.equal(clean.changed, false);
  assert.equal(ids, 0);
  assert.deepEqual(parseStudio(clean.document), {});
});
test('retirement removes only exact known assignments/catalog entries, preserves current user settings and does not mutate input', () => {
  const user = profile('agent'),
    assistant = createSystemAgents(() => 'assistant');
  const resources = [
    resource(obsolete, 'builtin:library'),
    resource('custom-mcp', 'https://example.invalid/mcp'),
  ];
  const raw = {
    schemaVersion: 1,
    sections: {
      agents: [user],
      systemAgents: assistant,
      resources,
      libraryAgents: { characters: user.id, locations: '' },
      hiddenLibraryIds: ['old-asset'],
      baseInstruction: 'User base text',
      connections: [],
    },
  };
  const original = structuredClone(raw);
  const result = retireLegacyFeatures(raw);
  assert.equal(result.changed, true);
  assert.deepEqual(raw, original);
  const parsed = parseStudio(result.document);
  const agent = (parsed.agents as Agent[])[0];
  assert.deepEqual(agent, {
    ...user,
    mcps: ['custom-mcp'],
    capabilitySettings: { 'mcps:custom-mcp': { enabled: true } },
  });
  assert.deepEqual(parsed.resources, [resources[1]]);
  assert.deepEqual(parsed.systemAgents, assistant);
  assert.equal(parsed.baseInstruction, 'User base text');
  assert.equal('libraryAgents' in parsed, false);
  assert.equal('hiddenLibraryIds' in parsed, false);
  assert.equal(retireLegacyFeatures(result.document).changed, false);
  assert.equal(
    retiredBuiltin('my-library-server', 'https://example.invalid/library'),
    false,
    'Similar names never identify a retired built-in',
  );
});
test('former system profiles keep IDs/prompts/models and move to a dedicated team without changing existing teams', () => {
  const char = profile('character-id'),
    loc = profile('location-id');
  const assistant = createSystemAgents(() => 'assistant');
  const teams = [
    { id: 'team-a', name: 'A', agentIds: ['a'] },
    { id: 'team-b', name: 'B', agentIds: ['b'] },
  ];
  const raw = {
    schemaVersion: 1,
    sections: {
      agents: [profile('a'), profile('b')],
      agentTeams: teams,
      systemAgents: [
        { ...char, systemRole: 'character' },
        { ...loc, systemRole: 'location' },
        ...assistant,
      ],
    },
  };
  const result = retireLegacyFeatures(raw, () => 'compat-team');
  const parsed = parseStudio(result.document);
  assert.deepEqual((parsed.agentTeams as unknown[]).slice(0, 2), teams);
  assert.deepEqual((parsed.agentTeams as unknown[])[2], {
    id: 'compat-team',
    name: 'Перенесённые агенты',
    agentIds: [char.id, loc.id],
  });
  const agents = parsed.agents as Agent[];
  for (const original of [char, loc])
    assert.deepEqual(
      agents.find((a) => a.id === original.id),
      withoutRetiredResources(original),
    );
  assert.deepEqual(parsed.systemAgents, assistant);
  assert.equal(retireLegacyFeatures(result.document).changed, false);
});
test('duplicate stable IDs reject the transition without partial changes or silently replacing profiles', () => {
  const agent = profile('same');
  const raw = {
    schemaVersion: 1,
    sections: { agents: [agent], systemAgents: [{ ...agent, systemRole: 'character' }] },
  };
  const before = structuredClone(raw);
  assert.throws(() => retireLegacyFeatures(raw), /ID/);
  assert.deepEqual(raw, before);
});

test('opening a real legacy studio retires only metadata, keeps profiles/materials/project/JSONL, and is idempotent', async (t) => {
  const { mkdtemp, mkdir, readFile, writeFile, rm, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { StudioStore } = await import('../src/main/storage/StudioStore.ts');
  const root = await mkdtemp(join(tmpdir(), 'pistudio-retirement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const user = { ...profile('ordinary'), skills: [], plugins: [], mcps: [obsolete] };
  await store.saveSection('agents', [user]);
  const project = (
    await store.command({
      kind: 'create',
      name: 'User work',
      agents: [user],
      teamId: store.agentCatalog().teams[0].id,
    })
  ).projects[0];
  const projectRoot = await store.projects.directory(project.id);
  const session = {
    id: 'canonical',
    title: 'Exact conversation',
    createdAt: 123,
    path: project.agents[0].outputPath.replace(/output$/, 'sessions/history.jsonl'),
  };
  await store.projects.updateRuntime(project.id, user.id, 'waiting', session);
  const projectFile = join(projectRoot, 'project.json');
  const materialPaths = [
    '.pistudio/library-runs/old-job/agents/creator/sessions/old.jsonl',
    '.pistudio/setup-assistant/agents/assistant/sessions/helper.jsonl',
    'library/characters/user-material/versions/1/asset.json',
    'library/locations/user-material/reference.png',
    'projects/' + project.folderName + '/' + session.path,
    'projects/' + project.folderName + '/' + project.agents[0].outputPath + '/result.md',
  ];
  const contents = new Map<string, Buffer>();
  for (const [index, path] of materialPaths.entries()) {
    const file = join(root, path),
      bytes = Buffer.from('Unchanged material ' + index + '\n');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, bytes);
    contents.set(path, bytes);
  }
  const settingsFile = join(root, '.pistudio/studio.json');
  const raw = JSON.parse(await readFile(settingsFile, 'utf8'));
  raw.sections.libraryAgents = { characters: 'former', locations: '' };
  raw.sections.hiddenLibraryIds = ['old-material'];
  raw.sections.resources = [resource(obsolete, 'builtin:library')];
  const former = { ...profile('former'), systemRole: 'character', skills: [], plugins: [] };
  raw.sections.systemAgents.push(former);
  await writeFile(settingsFile, JSON.stringify(raw));
  const originalProject = await readFile(projectFile);
  const reopened = await StudioStore.open(root);
  const current = reopened.bootstrap().sections;
  assert.equal('library' in reopened, false);
  assert.equal('libraryAgents' in current, false);
  assert.equal('hiddenLibraryIds' in current, false);
  assert.deepEqual(current.resources, []);
  assert.deepEqual(
    (current.agents as Agent[]).map((a) => a.id),
    [user.id, former.id],
  );
  assert.deepEqual(
    (current.agents as Agent[])[1],
    withoutRetiredResources((({ systemRole: _role, ...agent }) => agent)(former)),
  );
  assert.deepEqual(
    (current.systemAgents as Agent[]).map((a) => a.id),
    raw.sections.systemAgents.slice(0, 1).map((a: Agent) => a.id),
  );
  assert.deepEqual(await readFile(projectFile), originalProject);
  for (const [path, bytes] of contents) assert.deepEqual(await readFile(join(root, path)), bytes);
  const migrated = await readFile(settingsFile);
  await StudioStore.open(root);
  assert.deepEqual(await readFile(settingsFile), migrated);
  assert.deepEqual((await reopened.projects.read(project.id)).agents[0].session, {
    ...session,
    needsFork: false,
  });
  assert.equal((await readdir(join(root, '.pistudio'))).includes('library-jobs'), false);
});

test('invalid legacy metadata fails before writing studio settings', async (t) => {
  const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { StudioStore } = await import('../src/main/storage/StudioStore.ts');
  const root = await mkdtemp(join(tmpdir(), 'pistudio-invalid-retirement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.pistudio'));
  const file = join(root, '.pistudio/studio.json');
  const raw = JSON.stringify({
    schemaVersion: 1,
    sections: {
      agents: [profile('same')],
      systemAgents: [{ ...profile('same'), systemRole: 'character' }],
      hiddenLibraryIds: [],
    },
  });
  await writeFile(file, raw);
  await assert.rejects(() => StudioStore.open(root), /ID/);
  assert.equal(await readFile(file, 'utf8'), raw);
});

test('retired built-in team packet is rejected before materialization or catalog mutation', async (t) => {
  const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { gzipSync } = await import('node:zlib');
  const { StudioStore } = await import('../src/main/storage/StudioStore.ts');
  const { importTeam } = await import('../src/main/teams/importTeam.ts');
  const root = await mkdtemp(join(tmpdir(), 'pistudio-retired-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const before = await readFile(join(root, '.pistudio/studio.json'));
  const packet = gzipSync(
    JSON.stringify({
      manifest: {
        format: 'pi-studio-team',
        version: 1,
        team: { name: 'Old user team' },
        agents: [
          {
            ...profile('portable'),
            skills: [],
            plugins: [],
            mcps: ['resource-0'],
            model: undefined,
          },
        ],
        resources: [{ ...resource('resource-0', 'builtin:library'), requirements: [] }],
        connections: [],
        requirements: [],
      },
      files: [],
    }),
  );
  await assert.rejects(() => importTeam(store, packet), /назначение удалённого встроенного MCP/);
  assert.deepEqual(await readFile(join(root, '.pistudio/studio.json')), before);
  assert.equal((await readdir(join(root, '.pistudio'))).includes('team-imports'), false);
  assert.deepEqual(store.agentCatalog(), { agents: [], teams: [] });
});

test('old selected page restores Projects without retaining an obsolete project selection', async () => {
  const { parseUpdateView } = await import('../src/main/updates/UpdateViewStore.ts');
  assert.deepEqual(parseUpdateView({ page: 'library', projectId: 'old' }), { page: 'projects' });
  assert.equal(parseUpdateView({ page: 12 }), undefined);
  assert.deepEqual(parseUpdateView({ page: 'project', projectId: 'work' }), {
    page: 'project',
    projectId: 'work',
  });
});
