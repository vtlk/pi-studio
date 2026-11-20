import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { builtinResources, optionalBuiltinMcps } from '../src/shared/builtinResources.ts';
import { hasBuiltinMcp, normalizeBuiltinAssignments } from '../src/shared/builtinAssignments.ts';
import { createSystemAgents } from '../src/shared/systemAgents.ts';
import { parseAgent, parseSystemAgents } from '../src/main/storage/validation.ts';
import { resolveResources } from '../src/main/pi/resources.ts';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import { browserAssigned } from '../bundled/pi-bridge/browser/authorization.mjs';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import { exportTeam } from '../src/main/teams/exportTeam.ts';

const draft = {
  id: 'agent-one',
  name: 'Agent',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
};

test('ordinary agents receive real administrative tools only through explicit assignment; disabling revokes access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-administration-assignment-'));
  try {
    const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
    const store = await service.load();
    const agent = parseAgent(draft);
    await store.saveSection('agents', [agent]);
    const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
      .projects[0];
    const run = {
      projectRoot: await store.projects.directory(project.id),
      project,
      agent: project.agents[0],
    } as unknown as PreparedRun;
    const administration = new SetupAdministration(service, async () => ({
      providers: [],
      models: [],
    }));
    await assert.rejects(administration.call(run, 'list_configuration', {}));
    await assert.rejects(administration.call(run, 'read_agent_settings', { agent_id: agent.id }));
    const assigned = { ...agent, mcps: [...agent.mcps, 'pistudio-administration'] };
    await store.saveSection('agents', [assigned]);
    const configuration = (await administration.call(run, 'list_configuration', {})) as {
      resources: unknown[];
    };
    assert.equal(configuration.resources.length, builtinResources.length);
    const readable = await administration.call(run, 'read_agent_settings', { agent_id: agent.id });
    assert.equal((readable as { agent: { id: string } }).agent.id, agent.id);
    const catalog = store.agentCatalog();
    const packaged = await exportTeam(catalog, catalog.teams[0].id, [], []);
    assert.equal(
      packaged.manifest.resources.some((resource) => resource.source === 'builtin:administration'),
      true,
    );
    await store.saveSection('agents', [
      { ...assigned, capabilitySettings: { 'mcps:pistudio-administration': { enabled: false } } },
    ]);
    await assert.rejects(administration.call(run, 'list_configuration', {}));
    await assert.rejects(administration.call(run, 'read_agent_settings', { agent_id: agent.id }));
    const helper = (store.bootstrap().sections.systemAgents as { id: string }[])[0];
    const helperRun = {
      projectRoot: join(store.folder, '.pistudio/setup-assistant'),
    } as PreparedRun;
    await assert.rejects(
      administration.call(helperRun, 'assign_resource', {
        agentId: helper.id,
        kind: 'mcps',
        resourceId: 'pistudio-browser',
        enabled: false,
      }),
    );
    assert.equal(store.bootstrap().sections.systemAgents?.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fresh ordinary agent has only Project; all other built-ins are explicit switchable assignments', async () => {
  const agent = parseAgent(draft);
  assert.deepEqual(agent.mcps, ['pistudio-project']);
  assert.equal(hasBuiltinMcp(agent, 'pistudio-browser'), false);
  assert.deepEqual(
    new Set(optionalBuiltinMcps.map((mcp) => mcp.id)),
    new Set(['pistudio-team', 'pistudio-browser', 'pistudio-computer', 'pistudio-administration']),
  );
  for (const resource of optionalBuiltinMcps) {
    const assigned = { ...agent, mcps: [...agent.mcps, resource.id] };
    assert.equal(hasBuiltinMcp(assigned, resource.id), true);
    const disabled = {
      ...assigned,
      capabilitySettings: { [`mcps:${resource.id}`]: { enabled: false } },
    };
    assert.equal(hasBuiltinMcp(disabled, resource.id), false);
    assert.equal(
      normalizeBuiltinAssignments(disabled).capabilitySettings?.[`mcps:${resource.id}`].enabled,
      false,
    );
  }
  assert.deepEqual(
    await resolveResources({ ...agent, mcps: builtinResources.map((mcp) => mcp.id) }, []),
    {
      skills: [],
      plugins: [],
      mcpServers: [],
    },
  );
});

test('fresh and legacy setup assistants retain every pinned built-in without losing custom settings', () => {
  const [fresh] = createSystemAgents(() => 'assistant-id');
  assert.deepEqual(
    fresh.mcps,
    builtinResources.map((resource) => resource.id),
  );
  const [legacy] = parseSystemAgents([
    {
      ...fresh,
      mainInstruction: 'custom text',
      mcps: ['external'],
      capabilitySettings: { 'mcps:pistudio-browser': { enabled: false } },
    },
  ]);
  assert.equal(legacy.id, fresh.id);
  assert.equal(legacy.mainInstruction, 'custom text');
  assert.equal(legacy.mcps.includes('external'), true);
  for (const resource of builtinResources) assert.equal(hasBuiltinMcp(legacy, resource.id), true);
  assert.equal(legacy.capabilitySettings?.['mcps:pistudio-browser'].enabled, true);
  assert.equal(normalizeBuiltinAssignments(legacy), legacy);
});

test('an existing browser transport rechecks saved switches, removal, assistant role and missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-assignments-'));
  try {
    const binding = { studioFile: join(root, 'studio.json'), agentId: draft.id };
    const save = async (agent: object) =>
      writeFile(binding.studioFile, JSON.stringify({ sections: { agents: [agent] } }));
    assert.equal(await browserAssigned(binding), false);
    await save(draft);
    assert.equal(await browserAssigned(binding), false);
    await save({ ...draft, mcps: ['pistudio-browser'] });
    assert.equal(await browserAssigned(binding), true);
    await save({
      ...draft,
      mcps: ['pistudio-browser'],
      capabilitySettings: { 'mcps:pistudio-browser': { enabled: false } },
    });
    assert.equal(await browserAssigned(binding), false);
    await save({ ...draft, systemRole: 'assistant' });
    assert.equal(await browserAssigned(binding), true);
    await writeFile(binding.studioFile, '{broken');
    assert.equal(await browserAssigned(binding), false);
    assert.equal(await browserAssigned({}), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Computer MCP is absent without an assignment and rejects new calls after a saved revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-computer-assignments-'));
  let calls = 0,
    discovery = 0,
    allowed = true;
  const computer = new ComputerSupport({
    tools: async () => {
      discovery++;
      return [{ name: 'capture', description: '', inputSchema: {} }];
    },
    permissions: async () => ({ accessibility: true, screenRecording: true }),
    call: async () => {
      calls++;
      return { content: [{ type: 'text', text: 'fixture' }] };
    },
    release: async () => {},
    close: async () => {},
  });
  const run = {
    projectRoot: root,
    agent: { profile: parseAgent(draft) },
    record: { runId: 'run-one', resourceIds: { mcps: [] } },
  } as unknown as PreparedRun;
  try {
    await computer.bind(run, true);
    assert.equal(discovery, 0);
    assert.deepEqual(computer.groups(run), []);
    run.agent.profile.mcps.push('pistudio-computer');
    await computer.bind(run, true, async () => allowed);
    const [group] = computer.groups(run);
    await group.call('capture', {}, new AbortController().signal);
    assert.equal(calls, 1);
    allowed = false;
    const denied = await group.call('capture', {}, new AbortController().signal);
    assert.equal(denied.isError, true);
    assert.equal(calls, 1);
  } finally {
    await computer.close();
    await rm(root, { recursive: true, force: true });
  }
});
