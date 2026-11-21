import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';
import { productionTools } from '../src/main/pi/RunChannel.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { teamMcpId } from '../src/shared/builtinResources.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';

test('runtime inspection uses the scoped native runtime without model selection or configuration changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-runtime-admin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const before = store.bootstrap().sections;
  let calls = 0;
  const runtime = {
    platform: 'win32',
    arch: 'x64',
    nodeVersion: 'v22.22.1',
    commands: { node: { command: 'D:\\Pi Studio\\node.exe', args: [] } },
  };
  const native = new StudioResources(service, {
    script: '',
    piPath: () => 'native-pi',
    operation: async (_path, _script, request) => {
      assert.equal(request.action, 'inspect-runtime');
      assert.equal(request.cwd, store.folder);
      calls++;
      return { runtime };
    },
  });
  const admin = new SetupAdministration(
    service,
    async () => {
      throw new Error('Runtime inspection must not call the model catalog');
    },
    native,
  );
  assert.deepEqual(
    await admin.call(
      { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun,
      'get_runtime',
      {},
    ),
    { runtime },
  );
  await assert.rejects(admin.call({ projectRoot: root } as PreparedRun, 'get_runtime', {}));
  assert.equal(calls, 1);
  assert.deepEqual(store.bootstrap().sections, before);
});

test('setup tools change only current constructor/catalog links and never snapshots or instruction copies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-setup-admin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const admin = new SetupAdministration(service, async () => ({
    providers: [{ id: 'provider', name: 'Provider', configured: true, subscription: true }],
    models: [
      { provider: 'provider', id: 'model', name: 'Model', reasoning: true, imageInput: true },
    ],
  }));
  assert.deepEqual(store.bootstrap().sections.agents, []);
  const team = (await admin.call(run, 'configure_team', { name: 'My team' })) as { teamId: string };
  const result = (await admin.call(run, 'register_connection', {
    name: 'My subscription',
    provider: 'provider',
  })) as { connection: { id: string; authScope: string } };
  assert.equal(result.connection.authScope, 'connection');
  const local = (await admin.call(run, 'register_model_endpoint', {
    name: 'My local model',
    purpose: 'local',
    endpoint: 'http://localhost:1234/v1/',
    endpointConfig: {
      api: 'openai-completions',
      auth: 'none',
      models: [
        {
          id: 'local-model',
          name: 'Local model',
          imageInput: false,
          reasoning: false,
          contextWindow: 4096,
          maxTokens: 1024,
        },
      ],
    },
  })) as { connection: Connection };
  assert.equal(local.connection.endpoint, 'http://localhost:1234/v1');
  assert.equal(local.connection.providerId, 'studio-' + local.connection.id);
  const localAgent = (await admin.call(run, 'configure_agent', {
    name: 'Local role',
    teamId: team.teamId,
    model: {
      connectionId: local.connection.id,
      provider: local.connection.providerId,
      id: 'local-model',
      reasoning: 'По умолчанию',
    },
  })) as { agentId: string };
  assert.ok(localAgent.agentId);
  await assert.rejects(
    () =>
      admin.call(run, 'register_model_endpoint', {
        id: 'missing',
        name: 'Missing',
        purpose: 'local',
        endpoint: 'http://localhost:1234/v1',
      }),
    /отсутствует/,
  );
  const created = (await admin.call(run, 'configure_agent', {
    name: 'My role',
    teamId: team.teamId,
    mainInstruction: 'Current role only',
    model: {
      connectionId: result.connection.id,
      provider: 'provider',
      id: 'model',
      reasoning: 'Средний',
    },
  })) as { agentId: string };
  const agents = store.bootstrap().sections.agents as Agent[];
  assert.deepEqual(
    new Set(agents.find(({ id }) => id === created.agentId)?.mcps),
    new Set([
      'pistudio-project',
      'pistudio-team',
      'pistudio-browser',
      'pistudio-computer',
      'pistudio-administration',
    ]),
  );
  const project = (await store.command({ kind: 'create', name: 'My film', agents })).projects[0];
  const snapshot = structuredClone((await store.projects.read(project.id)).agents);
  await admin.call(run, 'configure_agent', {
    id: created.agentId,
    mainInstruction: 'Changed current role',
  });
  assert.deepEqual((await store.projects.read(project.id)).agents, snapshot);
  const skill = join(root, 'custom-skill');
  await mkdir(skill);
  await writeFile(
    join(skill, 'SKILL.md'),
    '---\nname: custom-skill\ndescription: My custom skill\n---\n\nCURRENT_SKILL_TEXT',
  );
  const imported = (await admin.call(run, 'import_skill', { path: skill })) as {
    resource: { id: string };
  };
  await admin.call(run, 'assign_resource', {
    agentId: created.agentId,
    resourceId: imported.resource.id,
    kind: 'skills',
    enabled: true,
  });
  const changed = (store.bootstrap().sections.agents as Agent[]).find(
    (item) => item.id === created.agentId,
  )!;
  assert.deepEqual(changed.skills, [imported.resource.id]);
  await admin.call(run, 'assign_resource', {
    agentId: created.agentId,
    resourceId: teamMcpId,
    kind: 'mcps',
    enabled: true,
  });
  assert.ok(
    (store.bootstrap().sections.agents as Agent[])
      .find((agent) => agent.id === created.agentId)!
      .mcps.includes(teamMcpId),
  );
  const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
  assert.equal(systems.length, 1);
  assert.equal(systems[0].systemRole, 'assistant');
  await assert.rejects(
    admin.call(run, 'assign_resource', {
      agentId: systems[0].id,
      resourceId: 'pistudio-library',
      kind: 'mcps',
    }),
    /отсутствует в каталоге/,
  );
  await admin.call(run, 'assign_resource', {
    agentId: created.agentId,
    resourceId: 'pistudio-administration',
    kind: 'mcps',
  });
  assert.equal(
    (store.bootstrap().sections.agents as Agent[])
      .find((agent) => agent.id === created.agentId)!
      .mcps.includes('pistudio-administration'),
    true,
  );
  assert.deepEqual((await store.projects.read(project.id)).agents, snapshot);
  const metadata = JSON.stringify(await admin.call(run, 'list_configuration', {}));
  assert.equal(metadata.includes('Changed current role'), false);
  assert.equal(metadata.includes('CURRENT_SKILL_TEXT'), false);
  await assert.rejects(
    admin.call(run, 'configure_agent', { id: 'deleted', name: 'Should not create a replacement' }),
  );
  await assert.rejects(
    admin.call(run, 'assign_resource', {
      agentId: created.agentId,
      resourceId: 'unknown',
      kind: 'skills',
    }),
  );
  await service.open(join(root, 'another-studio'));
  await assert.rejects(
    admin.call(run, 'configure_agent', { name: 'Wrong scope' }),
    /не назначен|отключён/,
  );
  assert.deepEqual((await service.load()).bootstrap().sections.agents, []);
});
test('administrative tools are scoped separately from every production lease', () => {
  assert.ok(setupTools.some((tool) => tool.name === 'configure_agent'));
  assert.equal(
    productionTools.some((tool) => tool.name === 'configure_agent'),
    false,
  );
  assert.ok(setupTools.some((tool) => tool.name === 'web_search'));
  assert.ok(productionTools.some((tool) => tool.name === 'web_search'));
  assert.equal(
    setupTools.some((tool) => tool.name === 'complete_stage'),
    false,
  );
});

test('compact exact team reads, profile batch and scoped reorder/copy/move preserve live and saved project state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-scoped-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const agent: Agent = {
    id: 'a',
    name: 'Сценарист',
    enabled: true,
    mainInstruction: 'EXACT_PRIVATE_PROMPT',
    instructions: [{ id: 'rule', name: 'Rule', content: 'EXACT_DISABLED_TEXT', enabled: false }],
    skills: ['skill'],
    plugins: ['plugin'],
    mcps: ['pistudio-project', 'mcp'],
    capabilitySettings: { 'mcps:mcp': { enabled: false } },
    model: {
      id: 'model',
      provider: 'provider',
      connectionId: 'one',
      reasoning: 'high',
      temperature: '0.4',
    },
  };
  const other = { ...agent, id: 'b', name: 'Редактор' };
  const third = { ...agent, id: 'c', name: 'Внешний агент' };
  await store.saveSection('agentCatalog', {
    agents: [agent, other, third],
    teams: [
      { id: 'one', name: 'Основная', agentIds: ['a', 'b'] },
      { id: 'two', name: 'Вторая', agentIds: ['c'] },
    ],
  });
  const project = (
    await store.command({
      kind: 'create',
      name: 'Saved project',
      teamId: 'one',
      agents: store.teamProfiles('one'),
    })
  ).projects[0];
  const saved = structuredClone(store.projects.snapshot(project.id));
  const admin = new SetupAdministration(service, async () => {
    throw Error('Model catalog must not be consulted');
  });
  const read = (name: string, args: Record<string, unknown>) => admin.call(run, name, args);
  const teams = (await read('list_teams', { query: 'основная' })) as { items: object[] };
  assert.deepEqual(teams.items, [
    { id: 'one', name: 'Основная', workspaceMode: 'per-agent', agentCount: 2 },
  ]);
  const members = (await read('list_agents', { team_id: 'one' })) as { items: { id: string }[] };
  assert.deepEqual(
    members.items.map(({ id }) => id),
    ['a', 'b'],
  );
  await assert.rejects(read('list_agents', {}));
  const batch = (await read('read_agent_settings', {
    agent_ids: ['b', 'a'],
    sections: ['model', 'resources'],
  })) as { agents: { agent: { id: string } }[] };
  assert.deepEqual(
    batch.agents.map(({ agent }) => agent.id),
    ['b', 'a'],
  );
  assert.doesNotMatch(JSON.stringify(batch), /EXACT_PRIVATE_PROMPT|EXACT_DISABLED_TEXT/);
  await assert.rejects(read('read_agent_settings', { agent_ids: ['a', 'a'], sections: ['model'] }));
  const instruction = await read('read_agent_settings', {
    agent_id: 'a',
    sections: ['instructions'],
    instruction_ids: ['rule'],
  });
  assert.match(JSON.stringify(instruction), /EXACT_DISABLED_TEXT/);
  assert.doesNotMatch(JSON.stringify(instruction), /EXACT_PRIVATE_PROMPT/);
  await assert.rejects(read('reorder_team_agents', { team_id: 'one', agent_ids: ['b', 'c'] }));
  await read('reorder_team_agents', { team_id: 'one', agent_ids: ['b', 'a'] });
  assert.deepEqual(
    store.teamProfiles('one').map(({ id }) => id),
    ['b', 'a'],
  );
  await assert.rejects(
    read('transfer_agent', {
      agent_id: 'a',
      source_team_id: 'two',
      target_team_id: 'one',
      mode: 'move',
    }),
  );
  const copy = (await read('transfer_agent', {
    agent_id: 'a',
    source_team_id: 'one',
    target_team_id: 'one',
    mode: 'copy',
    before_agent_id: 'b',
  })) as { agentId: string };
  assert.notEqual(copy.agentId, 'a');
  assert.equal(store.teamProfiles('one')[0].id, copy.agentId);
  assert.deepEqual(store.teamProfiles('one')[0], { ...agent, id: copy.agentId });
  await read('transfer_agent', {
    agent_id: 'a',
    source_team_id: 'one',
    target_team_id: 'two',
    mode: 'move',
    before_agent_id: 'c',
  });
  assert.deepEqual(
    store.teamProfiles('two').map(({ id }) => id),
    ['a', 'c'],
  );
  assert.deepEqual(store.teamProfiles('two')[0], agent);
  assert.deepEqual(store.projects.snapshot(project.id), saved);
});

test('model discovery calls only the exact account and excludes other providers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-scoped-models-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  await store.saveSection('connections', [
    {
      id: 'one',
      name: 'Local account',
      purpose: 'pi',
      providerId: 'provider',
      endpoint: '',
      account: 'PRIVATE_ACCOUNT',
      createdAt: 1,
    },
  ]);
  let calls = 0;
  const admin = new SetupAdministration(service, async (connection) => {
    assert.equal(connection?.id, 'one');
    calls++;
    return {
      providers: [],
      models: ['provider', 'unrelated'].map((provider) => ({
        provider,
        id: provider + '-model',
        name: provider,
        reasoning: true,
        reasoningLevels: ['low'],
        imageInput: true,
      })),
    };
  });
  const connections = await admin.call(run, 'list_connections', {});
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(connections), /PRIVATE_ACCOUNT/);
  const result = (await admin.call(run, 'list_models', { connection_id: 'one' })) as {
    items: { id: string }[];
  };
  assert.deepEqual(
    result.items.map(({ id }) => id),
    ['provider-model'],
  );
  assert.equal(calls, 1);
});

test('single profile edits preserve sibling fields and reject ambiguous or pinned changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-profile-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const admin = new SetupAdministration(service, async () => {
    throw Error('Unexpected model catalog lookup for a local settings edit');
  });
  const { teamId } = (await admin.call(run, 'configure_team', { name: 'Patch team' })) as {
    teamId: string;
  };
  const { agentId } = (await admin.call(run, 'configure_agent', {
    teamId,
    name: 'Target',
    mainInstruction: 'Keep the main prompt',
    instructions: [
      { id: 'first', name: 'First', content: 'Unchanged' },
      { id: 'second', name: 'Second', content: 'Old', enabled: false },
    ],
  })) as { agentId: string };
  const before = structuredClone(store.teamProfiles(teamId)[0]);
  const update = { agent_id: agentId, action: 'update', instruction_id: 'second' };
  await admin.call(run, 'edit_agent_instruction', { ...update, enabled: true, content: 'New' });
  const { instructionId } = (await admin.call(run, 'edit_agent_instruction', {
    agent_id: agentId,
    action: 'add',
    name: 'Last',
    content: 'Appended',
  })) as { instructionId: string };
  const after = structuredClone(store.teamProfiles(teamId)[0]);
  assert.deepEqual(after, {
    ...before,
    instructions: [
      before.instructions[0],
      { ...before.instructions[1], content: 'New', enabled: true },
      { id: instructionId, name: 'Last', content: 'Appended', enabled: true },
    ],
  });
  await assert.rejects(
    admin.call(run, 'edit_agent_instruction', { ...update, action: 'remove', name: 'Also edit' }),
  );
  await assert.rejects(
    admin.call(run, 'edit_agent_instruction', {
      ...update,
      instruction_id: 'unknown',
      enabled: false,
    }),
  );
  await assert.rejects(
    admin.call(run, 'assign_resource', {
      agentId,
      resourceId: 'pistudio-project',
      kind: 'mcps',
      remove: true,
    }),
  );
  await assert.rejects(
    admin.call({ projectRoot: root } as PreparedRun, 'edit_agent_instruction', {
      ...update,
      enabled: false,
    }),
  );
  assert.deepEqual(store.teamProfiles(teamId)[0], after);
  await admin.call(run, 'assign_resource', {
    agentId,
    resourceId: teamMcpId,
    kind: 'mcps',
    enabled: false,
  });
  assert.deepEqual(store.teamProfiles(teamId)[0].capabilitySettings?.[`mcps:${teamMcpId}`], {
    enabled: false,
  });
  await admin.call(run, 'assign_resource', {
    agentId,
    resourceId: teamMcpId,
    kind: 'mcps',
    remove: true,
  });
  const updated = store.teamProfiles(teamId)[0];
  assert.ok(!updated.mcps.includes(teamMcpId));
  assert.equal(updated.capabilitySettings?.[`mcps:${teamMcpId}`], undefined);
  assert.deepEqual(updated.instructions, after.instructions);
});
