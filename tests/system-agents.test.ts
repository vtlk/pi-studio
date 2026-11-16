import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';

test('one editable setup profile persists separately and cannot be removed, replaced or copied into projects', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-systems-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = await StudioStore.open(root);
  const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
  assert.deepEqual(
    systems.map((agent) => agent.systemRole),
    ['assistant'],
  );
  assert.equal(new Set(systems.map((agent) => agent.id)).size, 1);
  for (const agent of systems) assert.match(agent.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(store.bootstrap().sections.agents, []);
  const edited = systems.map((agent) =>
    agent.systemRole === 'assistant'
      ? {
          ...agent,
          name: 'My character artist',
          mainInstruction: 'Custom current role',
          skills: ['my-skill'],
          model: {
            connectionId: 'account',
            provider: 'provider',
            id: 'model',
            reasoning: 'low',
            temperature: '',
          },
        }
      : agent,
  );
  await store.saveSection('systemAgents', edited);
  store = await StudioStore.open(root);
  assert.deepEqual(store.bootstrap().sections.systemAgents, edited);
  const original = await readFile(join(root, '.pistudio/studio.json'), 'utf8');
  for (const invalid of [
    edited.slice(1),
    [...edited, edited[0]],
    edited.map((agent, index) => (index ? agent : { ...agent, id: 'replacement' })),
    edited.map((agent, index) => (index ? agent : { ...agent, systemRole: 'character' })),
  ])
    await assert.rejects(() => store.saveSection('systemAgents', invalid));
  await assert.rejects(() => store.saveSection('agents', [edited[0]]));
  await assert.rejects(() =>
    store.command({ kind: 'create', name: 'Must not create', agents: edited }),
  );
  assert.equal(await readFile(join(root, '.pistudio/studio.json'), 'utf8'), original);
  const empty = (await store.command({ kind: 'create', name: 'Empty', agents: [] })).projects[0];
  assert.deepEqual(empty.agents, []);
  await assert.rejects(() =>
    store.command({
      kind: 'update-agents',
      projectId: empty.id,
      agents: edited,
      updateExisting: true,
    }),
  );
  assert.deepEqual((await store.projects.read(empty.id)).agents, []);
});

test('the setup assistant edits existing system resources/instructions but creates only appended project agents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-system-admin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const admin = new SetupAdministration(service, async () => ({ providers: [], models: [] }));
  const helper = (store.bootstrap().sections.systemAgents as SystemAgent[]).find(
    (agent) => agent.systemRole === 'assistant',
  )!;
  const ids = (store.bootstrap().sections.systemAgents as SystemAgent[]).map((agent) => agent.id);
  await admin.call(run, 'configure_agent', {
    id: helper.id,
    mainInstruction: 'Updated service instructions',
    name: 'Custom helper',
  });
  const team = (await admin.call(run, 'configure_team', { name: 'My team' })) as { teamId: string };
  const a = (await admin.call(run, 'configure_agent', {
    name: 'First role',
    teamId: team.teamId,
  })) as {
    agentId: string;
  };
  const b = (await admin.call(run, 'configure_agent', {
    name: 'Second role',
    teamId: team.teamId,
  })) as {
    agentId: string;
  };
  assert.deepEqual(
    (store.bootstrap().sections.agents as { id: string }[]).map((agent) => agent.id),
    [a.agentId, b.agentId],
  );
  const updated = store.bootstrap().sections.systemAgents as SystemAgent[];
  assert.deepEqual(
    updated.map((agent) => agent.id),
    ids,
  );
  assert.equal(
    updated.find((agent) => agent.id === helper.id)?.mainInstruction,
    'Updated service instructions',
  );
  const visible = (await admin.call(run, 'list_configuration', {})) as {
    systemAgents: { id: string; deletable: boolean; builtinMcp: string }[];
  };
  assert.equal(visible.systemAgents.length, 1);
  await admin.call(run, 'assign_resource', {
    agentId: a.agentId,
    kind: 'mcps',
    resourceId: 'pistudio-team',
  });
  assert.deepEqual((store.bootstrap().sections.agents as { mcps: string[] }[])[0].mcps, [
    'pistudio-project',
    'pistudio-team',
  ]);
  await assert.rejects(
    () =>
      admin.call(run, 'assign_resource', {
        agentId: helper.id,
        kind: 'mcps',
        resourceId: 'pistudio-library',
      }),
    /отсутствует в каталоге/,
  );
  assert.ok(
    visible.systemAgents.every((agent) => !agent.deletable && agent.builtinMcp === 'pinned'),
  );
});

test('an unconfigured system assistant neither chooses a hidden model nor creates a Pi dialogue', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-system-unconfigured-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const profile = (store.bootstrap().sections.systemAgents as SystemAgent[]).find(
    (agent) => agent.systemRole === 'assistant',
  )!;
  let opened = false;
  const helper = createSetupAssistant(service, {
    bootstraps: join(root, 'boots'),
    bridge: '/not-needed',
    catalog: '/not-needed',
    piPath: () => '/not-needed',
    headless: true,
    openTerminal: async () => {
      opened = true;
    },
  });
  t.after(() => helper.close());
  await assert.rejects(
    helper.launch({ projectId: 'pi-setup-assistant', agentId: profile.id, autoContinue: false }),
    /Выберите подключение, модель и уровень рассуждения/,
  );
  assert.equal(opened, false);
  await assert.rejects(access(join(store.folder, '.pistudio/setup-assistant/state.json')));
});
