import test from 'node:test';
import { readAllSettings } from './settingsRead.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { TeamSupport } from '../src/main/team-mcp/TeamSupport.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { Agent } from '../src/shared/studio.ts';

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-helper-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const agent: Agent = {
    id: 'worker',
    name: 'Worker',
    enabled: true,
    skills: [],
    mcps: ['external'],
    plugins: [],
    mainInstruction: 'CURRENT_ROLE',
    instructions: [
      { id: 'on', name: 'Enabled', enabled: true, content: 'FULL_ENABLED_TEXT' },
      { id: 'off', name: 'Disabled', enabled: false, content: 'FULL_DISABLED_TEXT' },
    ],
    model: {
      connectionId: 'connection',
      provider: 'local',
      id: 'model',
      reasoning: 'Низкий',
      temperature: '',
    },
  };
  await store.saveSection('agents', [agent]);
  await store.saveSection('connections', [
    {
      id: 'connection',
      name: 'Local',
      providerId: 'local',
      purpose: 'local',
      endpoint: 'http://localhost/?token=SECRET_SENTINEL',
      account: 'SECRET_SENTINEL',
      createdAt: 1,
    },
  ]);
  await store.saveSection('resources', [
    {
      id: 'external',
      name: 'External MCP',
      kind: 'mcps',
      source: 'https://example.invalid/?token=SECRET_SENTINEL',
      args: '["SECRET_SENTINEL"]',
      credential: 'keychain:SECRET_SENTINEL',
      contents: 'SECRET_SENTINEL',
      description: 'Resource metadata',
      transport: '',
      version: '',
      createdAt: 1,
    },
  ]);
  const helper = (store.bootstrap().sections.systemAgents as SystemAgent[])[0];
  const run = {
    project: { id: 'pi-setup-assistant' },
    projectRoot: join(store.folder, '.pistudio/setup-assistant'),
    record: { agentId: helper.id, projectId: 'pi-setup-assistant' },
    teamAccess: true,
  } as PreparedRun;
  const team = new TeamSupport(service);
  t.after(() => team.close());
  const admin = new SetupAdministration(service, async () => {
    throw Error('Must not load model catalog');
  });
  return { root, service, store, agent, helper, run, team, admin };
}

test('helper Team and Administration read complete current constructor settings without any project or model lookup', async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.store.folder, '.pistudio/studio.json'));
  assert.deepEqual(f.store.projects.list(), []);
  const transport = f.team.groups(f.run)[0];
  assert.deepEqual(transport.tools.map((tool) => tool.name).sort(), [
    'list_agents',
    'read_agent_settings',
  ]);
  const listed = (await f.team.call(f.run, 'list_agents', {})) as { agents: { id: string }[] };
  assert.equal(listed.agents[0].id, 'worker');
  const throughTeam = await f.team.call(f.run, 'read_agent_settings', { agent_id: 'worker' });
  const throughAdmin = await f.admin.call(f.run, 'read_agent_settings', { agent_id: 'worker' });
  assert.deepEqual(throughTeam, throughAdmin);
  const result = throughTeam as {
    scope: string;
    currentConstructor: {
      mainInstruction: string;
      instructions: { content: string }[];
      roleInstructions: string;
      model: { id: string };
      resources: { name: string }[];
    };
    appliedRuntime: null;
  };
  assert.equal(result.scope, 'studio-constructor');
  assert.equal(result.currentConstructor.mainInstruction, 'CURRENT_ROLE');
  assert.deepEqual(
    result.currentConstructor.instructions.map((item) => item.content),
    ['FULL_ENABLED_TEXT', 'FULL_DISABLED_TEXT'],
  );
  assert.equal(result.currentConstructor.roleInstructions, undefined);
  const derived = (await f.admin.call(f.run, 'read_agent_settings', {
    agent_id: 'worker',
    include_derived_prompts: true,
  })) as typeof result;
  assert.ok(!derived.currentConstructor.roleInstructions.includes('FULL_DISABLED_TEXT'));
  assert.equal(result.currentConstructor.model.id, 'model');
  assert.ok(result.currentConstructor.resources.some((item) => item.name === 'External MCP'));
  assert.equal(result.appliedRuntime, null);
  assert.ok(!JSON.stringify(result).includes('SECRET_SENTINEL'));
  const own = await readAllSettings((args) => f.team.call(f.run, 'read_agent_settings', args), {
    agent_id: f.helper.id,
  });
  assert.equal((own as { agent: { systemRole: string } }).agent.systemRole, 'assistant');
  await assert.rejects(f.team.call(f.run, 'read_agent_settings', { agent_id: 'missing' }));
  await assert.rejects(f.team.call(f.run, 'read_agent_settings', { agent_id: '../worker' }));
  assert.deepEqual(f.store.projects.list(), []);
  assert.deepEqual(await readFile(join(f.store.folder, '.pistudio/studio.json')), before);
});

test('helper read authority never selects a project or enables delivery/output access and is checked on every call', async (t) => {
  const f = await fixture(t);
  for (const name of ['say_to', 'say_to_agent', 'list_output', 'read_output', 'message_status'])
    await assert.rejects(
      f.team.call(f.run, name, { agent_id: 'worker', text: 'Never sent', request_id: 'none' }),
    );
  await assert.rejects(
    f.team.call(
      { ...f.run, record: { ...f.run.record, agentId: 'worker' } },
      'read_agent_settings',
      { agent_id: f.helper.id },
    ),
  );
  await assert.rejects(
    f.team.call(
      { ...f.run, project: { ...f.run.project, id: 'ordinary-project' } },
      'read_agent_settings',
      { agent_id: f.helper.id },
    ),
  );
  await f.store.saveSection('agents', [{ ...f.agent, mainInstruction: 'UPDATED_CURRENT_ROLE' }]);
  const updated = await f.team.call(f.run, 'read_agent_settings', { agent_id: 'worker' });
  assert.ok(JSON.stringify(updated).includes('UPDATED_CURRENT_ROLE'));
  await f.store.saveSection('systemAgents', [{ ...f.helper, enabled: false }]);
  await assert.rejects(f.team.call(f.run, 'list_agents', {}));
  await f.store.saveSection('systemAgents', [f.helper]);
  await f.service.open(join(f.root, 'OtherStudio'));
  await assert.rejects(f.team.call(f.run, 'read_agent_settings', { agent_id: 'worker' }));
  await assert.rejects(f.admin.call(f.run, 'read_agent_settings', { agent_id: 'worker' }));
});
