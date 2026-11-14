import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { createLibraryRunHost } from '../src/main/pi/createLibraryRunHost.ts';

test('references preserve duplicate filenames, hashes and image content; originals can disappear after the copy', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-references-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(join(root, 'studio'));
  const agent: Agent = {
    id: 'qa-agent',
    name: 'QA agent',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'Низкий', temperature: '' },
  };
  await store.saveSection('agents', [agent]);
  const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
    .projects[0];
  const run = await buildRunContext(
    await store.projects.directory(project.id),
    project,
    agent.id,
    [agent],
    [],
  );
  await mkdir(join(root, 'first'));
  await mkdir(join(root, 'second'));
  await writeFile(join(root, 'first/same.txt'), 'first input');
  await writeFile(join(root, 'second/same.txt'), 'second input');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  await writeFile(join(root, 'image.png'), png);
  const files = new ReferenceFiles();
  const selected = await files.select(
    [join(root, 'first/same.txt'), join(root, 'second/same.txt'), join(root, 'image.png')],
    store.folder,
  );
  const ids = selected.map((file) => file.id);
  assert.throws(() => files.validate(ids, store.folder, false), /поддержку изображений/);
  assert.throws(() => files.validate(ids, root, true), /студия/);
  await files.attach(run, ids, store.folder, true);
  const saved = run.record.attachments!;
  assert.equal(saved.length, 3);
  assert.equal(saved[0].name, saved[1].name);
  assert.notEqual(saved[0].path, saved[1].path);
  assert.notEqual(saved[0].sha256, saved[1].sha256);
  await rm(join(root, 'first'), { recursive: true });
  assert.equal(await readFile(join(run.projectRoot, saved[0].path), 'utf8'), 'first input');
  assert.deepEqual(await readFile(join(run.projectRoot, saved[2].image!.path)), png);
  const context = await readFile(
    join(run.projectRoot, '.pistudio/context', run.record.runId, 'context.json'),
    'utf8',
  );
  assert.ok(!context.includes('mainInstruction'));
  assert.ok(!context.includes('first input'));
});

test('changed, missing, symlinked and unknown references fail explicitly and clean incomplete copies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-reference-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new ReferenceFiles();
  const path = join(root, 'input.txt');
  await writeFile(path, 'old');
  const selected = await files.select([path], root);
  await writeFile(path, 'new');
  const run = {
    projectRoot: root,
    agent: { outputPath: 'agents/qa/output' },
    record: { runId: 'test' },
  } as Parameters<ReferenceFiles['attach']>[0];
  await assert.rejects(() => files.attach(run, [selected[0].id], root, true), /изменился/);
  assert.deepEqual(await readdir(join(root, 'agents/qa/runs')), []);
  assert.throws(() => files.validate(['unknown'], root, true), /Выберите референсы/);
  await symlink(path, join(root, 'link.txt'));
  await assert.rejects(() => files.select([join(root, 'link.txt')], root));
  await rm(path);
  await assert.rejects(() => files.attach(run, [selected[0].id], root, true));
});

test('a library create request uses an explicitly assigned ordinary agent and never creates a project or falls back to another model', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-library-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  let opened = false;
  const generator = createLibraryRunHost(service, {
    bootstraps: join(root, 'boots'),
    bridge: '/unused',
    catalog: '/unused',
    piPath: () => '/unused',
    references: new ReferenceFiles(),
    headless: true,
    openTerminal: async () => {
      opened = true;
    },
  });
  t.after(() => generator.close());
  const agent: Agent = {
    id: 'artist',
    name: 'Artist',
    enabled: true,
    skills: [],
    mcps: ['pistudio-library'],
    plugins: [],
    instructions: [],
  };
  await store.saveSection('agents', [agent]);
  for (const kind of ['characters', 'locations'] as const)
    await assert.rejects(
      () =>
        generator.create({
          kind,
          agentId: 'artist',
          description: 'Make an asset',
          attachments: [],
        }),
      /Выберите подключение и модель/,
    );
  assert.equal(opened, false);
  assert.deepEqual(store.bootstrap().projects, []);
  assert.deepEqual(store.bootstrap().sections.agents, [agent]);
  assert.equal((store.bootstrap().sections.systemAgents as SystemAgent[]).length, 1);
  await assert.rejects(() => readdir(join(store.folder, '.pistudio/library-runs')));
});
