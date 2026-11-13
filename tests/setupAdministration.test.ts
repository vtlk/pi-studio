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
  const result = (await admin.call(run, 'register_connection', {
    name: 'My subscription',
    provider: 'provider',
  })) as { connection: { id: string } };
  const created = (await admin.call(run, 'configure_agent', {
    name: 'My role',
    mainInstruction: 'Current role only',
    model: {
      connectionId: result.connection.id,
      provider: 'provider',
      id: 'model',
      reasoning: 'Средний',
    },
  })) as { agentId: string };
  const agents = store.bootstrap().sections.agents as Agent[];
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
  const changed = (store.bootstrap().sections.agents as Agent[])[0];
  assert.deepEqual(changed.skills, [imported.resource.id]);
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
  await assert.rejects(admin.call(run, 'configure_agent', { name: 'Wrong scope' }), /другой папке/);
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
