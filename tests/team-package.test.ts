import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';
import { exportTeam } from '../src/main/teams/exportTeam.ts';
import { importTeam } from '../src/main/teams/importTeam.ts';
import { encodePackage, decodePackage, fileDigest } from '../src/main/teams/packageCodec.ts';
import { readImport, listImports } from '../src/main/teams/importState.ts';
import { handoffTeamImport } from '../src/main/teams/handoffTeamImport.ts';
import { TeamImportTools } from '../src/main/teams/TeamImportTools.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { StudioResources } from '../src/main/pi/StudioResources.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { teamMcpId } from '../src/shared/builtinResources.ts';

const profile = (id: string): Agent => ({
  id,
  name: 'Роль ' + id,
  enabled: true,
  mainInstruction: 'Current user prompt ' + id,
  instructions: [
    { id: 'instruction-' + id, name: 'Текущий блок', content: 'CURRENT_TEXT', enabled: false },
  ],
  skills: ['skill'],
  mcps: ['mcp', teamMcpId],
  plugins: ['plugin'],
  capabilitySettings: { 'skills:skill': { enabled: false } },
  model: {
    connectionId: 'sender-account',
    provider: 'test',
    id: 'required-model',
    reasoning: 'high',
    temperature: '',
  },
});
const account: Connection = {
  id: 'sender-account',
  name: 'Sender subscription',
  purpose: 'pi',
  providerId: 'test',
  endpoint: '',
  account: 'NEVER_EXPORT_ACCOUNT_AUTH',
  createdAt: 1,
};
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-team-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = join(root, 'skill');
  await mkdir(join(skill, 'references'), { recursive: true });
  await writeFile(
    join(skill, 'SKILL.md'),
    '---\nname: test-skill\ndescription: Current skill\n---\nCURRENT_SKILL\n',
  );
  await writeFile(join(skill, 'references', 'rule.md'), 'CURRENT_REFERENCE');
  await writeFile(join(skill, '.env'), 'NEVER_EXPORT_ENV');
  await symlink(join(root, 'outside'), join(skill, 'references', 'outside'));
  const resources: Resource[] = [
    {
      id: 'skill',
      name: 'Skill',
      kind: 'skills',
      source: skill,
      localSkill: true,
      description: '',
      version: 'current',
      transport: '',
      args: '',
      credential: '',
      contents: '',
      createdAt: 1,
    },
    {
      id: 'mcp',
      name: 'MCP',
      kind: 'mcps',
      source: 'pi:private-server',
      description: '',
      version: '',
      transport: 'http',
      args: '',
      credential: 'keychain:pistudio-mcp',
      contents: '',
      createdAt: 1,
    },
    {
      id: 'plugin',
      name: 'Package',
      kind: 'plugins',
      source: 'npm:pi-test@1.2.3',
      description: '',
      version: '1.2.3',
      transport: '',
      args: '',
      credential: '',
      contents: '',
      createdAt: 1,
    },
  ];
  const catalog = {
    agents: [
      profile('a'),
      profile('b'),
      { ...profile('foreign'), skills: [], mcps: [], plugins: [] },
    ],
    teams: [
      { id: 'team', name: 'Наша команда', agentIds: ['b', 'a'] },
      { id: 'foreign-team', name: 'Foreign', agentIds: ['foreign'] },
    ],
  };
  const data = await exportTeam(catalog, 'team', resources, [account], async () => ({
    url: 'https://example.invalid/mcp',
    headers: { 'X-Private': 'NEVER_EXPORT_HEADER' },
    env: { OPAQUE: 'NEVER_EXPORT_OPAQUE' },
    oauth: { clientId: 'public-client', clientSecret: 'NEVER_EXPORT_SECRET' },
  }));
  return { root, data, catalog, resources };
}

test('portable package includes full current prompts, disabled blocks and complete scoped skill files once; no unrelated profiles or credential values', async (t) => {
  const { data, root } = await fixture(t);
  const bytes = encodePackage(data),
    reopened = decodePackage(bytes),
    text = JSON.stringify(reopened);
  assert.deepEqual(
    reopened.manifest.agents.map((agent) => agent.id),
    ['b', 'a'],
  );
  assert.equal(reopened.manifest.agents[0].instructions[0].enabled, false);
  assert.equal(reopened.files.filter((file) => file.path.endsWith('/SKILL.md')).length, 1);
  assert.equal(
    Buffer.from(
      reopened.files.find((file) => file.path.endsWith('/rule.md'))!.data,
      'base64',
    ).toString(),
    'CURRENT_REFERENCE',
  );
  for (const secret of [
    'NEVER_EXPORT',
    'foreign-team',
    'Foreign',
    'Current user prompt foreign',
    root,
  ])
    assert.equal(text.includes(secret), false, secret);
  assert.equal(
    reopened.manifest.resources.some((resource) => resource.source === 'builtin:team'),
    true,
  );
  assert.ok(
    reopened.manifest.resources.some((resource) =>
      resource.requirements.some((issue) => issue.includes('.env')),
    ),
  );
  assert.ok(
    reopened.manifest.resources.some((resource) =>
      resource.requirements.some((issue) => issue.includes('outside')),
    ),
  );
  assert.equal(reopened.manifest.agents[0].model?.connectionId, 'connection-1');
  const mcp = reopened.manifest.resources.find((resource) => resource.name === 'MCP')!;
  assert.equal(mcp.authorization?.required, 'yes');
  assert.deepEqual(mcp.authorization?.methods, ['oauth', 'parameters']);
  assert.ok(mcp.authorization?.fields.some((field) => field.name === 'X-Private'));
  assert.equal(
    reopened.manifest.resources.find((resource) => resource.source === 'builtin:team')
      ?.authorization?.required,
    'no',
  );
});

test('old packages still derive actionable MCP requirements from validated local mappings; current team names survive rename', async (t) => {
  const { root, data } = await fixture(t);
  for (const resource of data.manifest.resources) delete resource.authorization;
  const store = await StudioStore.open(join(root, 'Old-package-target'));
  const imported = await importTeam(store, encodePackage(data));
  const catalog = store.agentCatalog();
  await store.saveSection('agentCatalog', {
    ...catalog,
    teams: catalog.teams.map((team) =>
      team.id === imported.teamId ? { ...team, name: 'Renamed team' } : team,
    ),
  });
  const [report] = await listImports(store);
  assert.equal(report.teamName, 'Renamed team');
  assert.equal(report.mcps?.length, 1, 'Internal MCPs do not require portable credentials');
  assert.equal(report.mcps![0].authorization.required, 'yes');
  const localResources = store.bootstrap().sections.resources as Resource[];
  assert.ok(localResources.some((resource) => resource.id === report.mcps![0].resourceId));
});

test('import atomically restores an independent team and file tree; repeated import never overwrites IDs, settings, models or other projects', async (t) => {
  const { data, root } = await fixture(t),
    target = await StudioStore.open(join(root, 'Target'));
  const own = { ...profile('own'), skills: [], mcps: [], plugins: [] };
  await target.saveSection('agents', [own]);
  const before = structuredClone(target.agentCatalog());
  const report = await importTeam(target, encodePackage(data));
  const after = target.agentCatalog(),
    imported = after.teams.find((team) => team.id === report.teamId)!;
  assert.deepEqual(
    after.agents.find((agent) => agent.id === 'own'),
    before.agents.find((agent) => agent.id === 'own'),
  );
  assert.deepEqual(after.teams[0], before.teams[0]);
  assert.equal(imported.name, 'Наша команда');
  assert.equal(imported.agentIds.length, 2);
  assert.ok(
    imported.agentIds.every((id) => !data.manifest.agents.some((agent) => agent.id === id)),
  );
  const restored = target.teamProfiles(report.teamId);
  assert.deepEqual(
    restored.map((agent) => agent.name),
    ['Роль b', 'Роль a'],
  );
  assert.equal(restored[0].mainInstruction, 'Current user prompt b');
  assert.equal(restored[0].instructions[0].content, 'CURRENT_TEXT');
  assert.equal(restored[0].instructions[0].enabled, false);
  assert.equal(restored[0].model?.id, 'required-model');
  assert.equal(restored[0].model?.reasoning, 'high');
  assert.equal(restored[0].model?.connectionId, '');
  const resources = target.bootstrap().sections.resources as Resource[];
  const skill = resources.find((resource) => resource.kind === 'skills')!;
  assert.ok(skill.source.startsWith(target.folder));
  assert.equal(restored[0].capabilitySettings?.[`skills:${skill.id}`]?.enabled, false);
  assert.equal(
    await readFile(join(skill.source, 'references/rule.md'), 'utf8'),
    'CURRENT_REFERENCE',
  );
  assert.equal((await readdir(join(target.folder, 'projects'))).length, 0);
  const second = await importTeam(target, encodePackage(data));
  assert.notEqual(second.teamId, report.teamId);
  assert.deepEqual(target.teamProfiles(report.teamId), restored);
  const again = await StudioStore.open(target.folder);
  assert.deepEqual(again.agentCatalog(), target.agentCatalog());
  assert.equal((await listImports(again)).length, 2);
});

test('invalid checksum, traversal, duplicate paths, missing resources and future archives leave studio bytes unchanged', async (t) => {
  const { root, data } = await fixture(t),
    store = await StudioStore.open(join(root, 'Target'));
  const file = join(store.folder, '.pistudio/studio.json'),
    before = await readFile(file, 'utf8');
  const invalidSkill = Buffer.from('not a skill header');
  const bads = [
    {
      ...data,
      files: data.files.map((file) =>
        file.path.endsWith('/SKILL.md')
          ? { ...file, data: invalidSkill.toString('base64'), sha256: fileDigest(invalidSkill) }
          : file,
      ),
    },
    { ...data, manifest: { ...data.manifest, version: 99 } },
    {
      ...data,
      files: data.files.map((file, index) => (index ? file : { ...file, sha256: '0'.repeat(64) })),
    },
    {
      ...data,
      files: data.files.map((file, index) =>
        index ? file : { ...file, path: 'resources/resource-1/files/../../escape' },
      ),
    },
    { ...data, files: [...data.files, data.files[0]] },
    { ...data, manifest: { ...data.manifest, resources: [] } },
  ];
  for (const bad of bads) {
    await assert.rejects(importTeam(store, gzipSync(Buffer.from(JSON.stringify(bad)))));
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(store.agentCatalog().teams, []);
  }
});

test('assistant handoff keeps exact IDs, defers busy/missing models, never resends after restart or an uncertain delivery', async (t) => {
  const { root, data } = await fixture(t),
    service = new StudioService(join(root, 'prefs.json'), join(root, 'Target')),
    store = await service.load();
  const report = await importTeam(store, encodePackage(data));
  let tasks = 0,
    opens = 0,
    busy = false,
    fail = false;
  const setup = {
    assertIdle() {
      if (busy) throw Error('busy');
    },
    async launchServiceTask(
      request: unknown,
      message: string,
      beforeDispatch?: () => Promise<void>,
    ) {
      await beforeDispatch?.();
      tasks++;
      assert.ok(message.includes(report.id));
      assert.ok(message.includes(report.teamId));
      assert.ok(message.includes('Наша команда'));
      if (fail) throw Error('uncertain');
      return {} as never;
    },
    async launch() {
      opens++;
      return {} as never;
    },
  };
  assert.equal(
    (await handoffTeamImport(service, setup, store.folder, report.id)).outcome,
    'needs_configuration',
  );
  assert.equal(tasks, 0);
  await store.saveSection('connections', [{ ...account, id: 'target-account' }]);
  await store.saveSection(
    'systemAgents',
    (store.bootstrap().sections.systemAgents as SystemAgent[]).map((agent) => ({
      ...agent,
      model: { ...profile('x').model!, connectionId: 'target-account' },
    })),
  );
  busy = true;
  assert.equal((await handoffTeamImport(service, setup, store.folder, report.id)).outcome, 'busy');
  assert.equal(tasks, 0);
  busy = false;
  await handoffTeamImport(service, setup, store.folder, report.id);
  assert.equal(tasks, 1);
  await handoffTeamImport(service, setup, store.folder, report.id);
  assert.equal(tasks, 1);
  assert.equal(opens, 1);
  const reopened = new StudioService(join(root, 'prefs.json'), join(root, 'Target'));
  await handoffTeamImport(reopened, setup, store.folder, report.id);
  assert.equal(tasks, 1);
  assert.equal(opens, 2);
  const second = await importTeam(store, encodePackage(data));
  fail = true;
  setup.launchServiceTask = async (_request, _message, beforeDispatch) => {
    await beforeDispatch?.();
    tasks++;
    throw Error('uncertain');
  };
  assert.equal(
    (await handoffTeamImport(service, setup, store.folder, second.id)).outcome,
    'uncertain',
  );
  const count = tasks;
  await handoffTeamImport(service, setup, store.folder, second.id);
  assert.equal(tasks, count);
  const third = await importTeam(store, encodePackage(data));
  setup.launchServiceTask = async () => {
    throw new Error('Pre-dispatch preparation failed');
  };
  assert.equal(
    (await handoffTeamImport(service, setup, store.folder, third.id)).outcome,
    'pending',
  );
  assert.equal((await readImport(store, third.id)).state.report.handoff, 'pending');
  setup.launchServiceTask = async (_request, _message, beforeDispatch) => {
    await beforeDispatch?.();
    tasks++;
    return {} as never;
  };
  await handoffTeamImport(service, setup, store.folder, third.id);
  assert.equal(
    tasks,
    count + 1,
    'Preparation failures are retryable without a lost or duplicate task',
  );
});

test('legacy assistant receipts do not swallow the new scoped MCP task; its own receipt persists without model changes or replay', async (t) => {
  const { root, data } = await fixture(t);
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Legacy-target'));
  const store = await service.load();
  const report = await importTeam(store, encodePackage(data));
  await store.saveSection('connections', [{ ...account, id: 'receiver' }]);
  await store.saveSection(
    'systemAgents',
    (store.bootstrap().sections.systemAgents as SystemAgent[]).map((agent) => ({
      ...agent,
      model: { ...profile('helper').model!, connectionId: 'receiver' },
    })),
  );
  const tools = new TeamImportTools(service, {} as StudioResources, async () => {});
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  await tools.call(run, 'read_team_import', { packageId: report.id });
  assert.equal((await readImport(store, report.id)).state.report.handoff, 'sent');
  const before = structuredClone(store.agentCatalog());
  let sends = 0,
    opens = 0;
  const setup = {
    assertIdle() {},
    async launchServiceTask(
      _request: unknown,
      message: string,
      beforeDispatch?: () => Promise<void>,
    ) {
      await beforeDispatch?.();
      sends++;
      assert.match(message, /MCP/);
      await tools.call(run, 'read_team_import', { packageId: report.id });
      return {} as never;
    },
    async launch() {
      opens++;
      return {} as never;
    },
  };
  assert.equal(
    (await handoffTeamImport(service, setup, store.folder, report.id)).outcome,
    'opened',
  );
  assert.equal(sends, 1);
  assert.equal((await readImport(store, report.id)).state.report.mcpHandoff, 'sent');
  await handoffTeamImport(service, setup, store.folder, report.id);
  assert.equal(sends, 1);
  assert.equal(opens, 1);
  assert.deepEqual(store.agentCatalog(), before);
  const uncertain = await importTeam(store, encodePackage(data));
  const legacy = await readImport(store, uncertain.id);
  legacy.state.report.handoff = 'uncertain';
  await writeFile(join(legacy.root, 'state.json'), JSON.stringify(legacy.state));
  assert.equal(
    (await handoffTeamImport(service, setup, store.folder, uncertain.id)).outcome,
    'uncertain',
  );
  assert.equal(sends, 1, 'Uncertain legacy dispatch is never retried by Onboarding');
});

test('narrow administrative tools read only their package, preserve missing model requirements and perform real checks without production launches', async (t) => {
  const { root, data } = await fixture(t),
    service = new StudioService(join(root, 'prefs.json'), join(root, 'Target')),
    store = await service.load();
  const report = await importTeam(store, encodePackage(data));
  let checks = 0;
  const native = {
    async check() {
      checks++;
      return { status: 'available', checkedAt: Date.now() };
    },
  } as unknown as StudioResources;
  const tools = new TeamImportTools(service, native, async () => {
    throw new Error('Explicit account mapping required');
  });
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const read = (await tools.call(run, 'read_team_import', { packageId: report.id })) as {
    report: typeof report;
  };
  assert.equal(read.report.handoff, 'sent');
  assert.equal((await readImport(store, report.id)).state.report.handoff, 'sent');
  await assert.rejects(
    tools.call(run, 'read_team_import_file', { packageId: report.id, path: '../../other' }),
  );
  await assert.rejects(
    tools.call({ projectRoot: join(root, 'foreign') } as PreparedRun, 'read_team_import', {
      packageId: report.id,
    }),
    /не назначен|отключён/,
  );
  const result = (await tools.call(run, 'check_team_import', { packageId: report.id })) as {
    configurationChecked: boolean;
    report: typeof report;
    productionAgentsLaunched: boolean;
  };
  assert.equal(result.configurationChecked, false);
  assert.equal(result.productionAgentsLaunched, false);
  assert.ok(checks > 0);
  assert.ok(
    result.report.agents.every((agent) =>
      agent.issues.includes('Explicit account mapping required'),
    ),
  );
});
