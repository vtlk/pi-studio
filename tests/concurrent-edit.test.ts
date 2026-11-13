import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';

const profile = {
  id: 'writer',
  name: 'Writer',
  enabled: true,
  mainInstruction: 'Current role',
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
};

test('stale CRUD writes cannot overwrite helper edits; a fresh read permits saving without instruction archives', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-concurrent-edit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'preferences.json'), join(root, 'studio'));
  const store = await service.load();
  await store.saveSection('agents', [profile]);
  const before = store.bootstrap();
  const helper = [
    { ...profile, name: 'Helper name' },
    { ...profile, id: 'new', name: 'New agent' },
  ];
  await service.serialize(() => store.saveSection('agents', helper));
  const local = [{ ...profile, mainInstruction: 'Unsaved local role' }];
  const disk = () => readFile(join(store.folder, '.pistudio/studio.json'), 'utf8');
  const helperFile = await disk();
  const stale = await service.serialize(() =>
    store.editSection('agents', local, {
      folder: before.folder,
      base: before.sections.agents,
    }),
  );
  assert.equal(stale.saved, false);
  assert.deepEqual(stale.value, helper);
  assert.equal(await disk(), helperFile);
  // A caller may neither omit the comparison nor send edits to a different studio.
  await assert.rejects(() => store.editSection('agents', local, undefined!));
  await assert.rejects(() => store.editSection('agents', local, { folder: root, base: helper }));
  assert.equal(await disk(), helperFile);
  // Normal CRUD after reading current data retains the helper-created record.
  const fresh = store.bootstrap();
  const updated = helper.map((agent) =>
    agent.id === 'writer' ? { ...agent, mainInstruction: 'New explicit role' } : agent,
  );
  const saved = await service.serialize(() =>
    store.editSection('agents', updated, {
      folder: fresh.folder,
      base: fresh.sections.agents,
    }),
  );
  assert.ok(saved.saved);
  assert.deepEqual(store.bootstrap().sections.agents, updated);
  const parsed = JSON.parse(await disk());
  assert.deepEqual(parsed, { schemaVersion: 1, sections: store.bootstrap().sections });
  assert.equal(
    (
      await store.editSection('agents', updated, {
        folder: store.folder,
        base: before.sections.agents,
      })
    ).saved,
    true,
  );
});

test('CRUD comparisons are per section and include resource checks, deletions and ordering', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-edit-sections-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'preferences.json'), join(root, 'studio'));
  const store = await service.load();
  const base = store.bootstrap();
  await store.saveSection('resources', [
    {
      id: 'r',
      name: 'Resource',
      kind: 'mcps',
      source: 'pi:server',
      args: '',
      credential: '',
      version: '',
      description: '',
      transport: 'HTTP',
      contents: '',
      createdAt: 1,
    },
  ]);
  assert.ok(
    (
      await store.editSection('agents', [profile], {
        folder: base.folder,
        base: base.sections.agents,
      })
    ).saved,
  );
  assert.equal(
    (
      await store.editSection('resources', [], {
        folder: base.folder,
        base: base.sections.resources,
      })
    ).saved,
    false,
  );
  const order = [profile, { ...profile, id: 'review' }];
  await store.saveSection('agents', order);
  await store.saveSection('agents', [...order].reverse());
  assert.equal(
    (await store.editSection('agents', [], { folder: base.folder, base: order })).saved,
    false,
  );
  assert.deepEqual(store.bootstrap().sections.agents, [...order].reverse());
});
