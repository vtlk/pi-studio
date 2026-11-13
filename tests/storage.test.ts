import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
  stat,
  realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';
import { loadOutput } from '../src/main/storage/outputs.ts';
import { mediaResponse } from '../src/main/storage/media.ts';
import { safePath, withReadDeadline } from '../src/main/storage/files.ts';
import type { Agent } from '../src/shared/studio.ts';

const agent = (id = 'writer'): Agent => ({
  id,
  name: 'Сценарист',
  enabled: true,
  mainInstruction: 'Не копировать этот текст в проект',
  instructions: [{ id: 'rule', name: 'Правило', content: 'Только текущий текст', enabled: true }],
  skills: ['script'],
  mcps: [],
  plugins: [],
  model: { provider: 'openai-codex', id: 'example', reasoning: 'high', temperature: '' },
});
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(join(root, 'studio'));
  return { root, store };
}

test('new studio is empty; current constructor, instructions and settings survive a restart', async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(store.bootstrap().projects, []);
  assert.deepEqual(store.bootstrap().sections.agents, []);
  assert.deepEqual(store.bootstrap().sections.connections, []);
  assert.deepEqual(store.bootstrap().sections.resources, []);
  assert.equal(store.bootstrap().sections.baseInstruction, '');
  await store.saveSection('agents', [agent()]);
  await store.saveSection('baseInstruction', 'Общее правило');
  await store.saveSection('hiddenLibraryIds', ['character-1']);
  const reopened = await StudioStore.open(store.folder);
  assert.deepEqual(reopened.bootstrap().sections.agents, [agent()]);
  assert.equal(reopened.bootstrap().sections.baseInstruction, 'Общее правило');
  assert.deepEqual(reopened.bootstrap().sections.hiddenLibraryIds, ['character-1']);
});
test('project creates stable output/session directories without instruction text, fake sessions or outputs', async (t) => {
  const { store } = await fixture(t);
  const { projects } = await store.command({
    kind: 'create',
    name: 'Первый фильм',
    agents: [agent()],
  });
  const project = projects[0];
  const root = await store.projects.directory(project.id);
  assert.ok((await stat(join(root, 'agents/scenarist/output'))).isDirectory());
  assert.ok((await stat(join(root, 'agents/scenarist/sessions'))).isDirectory());
  const raw = await readFile(join(root, 'project.json'), 'utf8');
  assert.equal(raw.includes('mainInstruction'), false);
  assert.equal(raw.includes('instructions'), false);
  assert.equal(raw.includes('Только текущий текст'), false);
  assert.deepEqual(await readdir(join(root, 'agents/scenarist/sessions')), []);
  assert.deepEqual((await store.projects.read(project.id)).agents[0].entries, []);
});
test('clone copies every project file into an independent folder and preserves the source snapshot', async (t) => {
  const { store } = await fixture(t);
  const source = (await store.command({ kind: 'create', name: 'Источник', agents: [agent()] }))
    .projects[0];
  const sourceRoot = await store.projects.directory(source.id);
  await mkdir(join(sourceRoot, 'extra'));
  await writeFile(join(sourceRoot, 'extra/binary.dat'), Buffer.from([0, 2, 3, 255]));
  await writeFile(join(sourceRoot, 'agents/scenarist/output/сценарий.md'), '# Сценарий');
  await store.saveSection('agents', [agent('new-global-agent')]);
  const cloned = await store.command({ kind: 'clone', projectId: source.id, name: 'Копия' });
  const copy = cloned.projects.find((project) => project.id === cloned.selectedId)!;
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.autoContinue, false);
  assert.deepEqual(
    copy.agents.map((agent) => agent.profile.id),
    ['writer'],
  );
  const copyRoot = await store.projects.directory(copy.id);
  assert.deepEqual(await readFile(join(copyRoot, 'extra/binary.dat')), Buffer.from([0, 2, 3, 255]));
  await writeFile(join(copyRoot, 'agents/scenarist/output/сценарий.md'), 'Изменённая копия');
  assert.equal(
    await readFile(join(sourceRoot, 'agents/scenarist/output/сценарий.md'), 'utf8'),
    '# Сценарий',
  );
});
test('rename changes the physical folder but preserves IDs, dates and relative files', async (t) => {
  const { store } = await fixture(t);
  const project = (await store.command({ kind: 'create', name: 'До', agents: [agent()] }))
    .projects[0];
  const root = await store.projects.directory(project.id);
  await writeFile(join(root, 'agents/scenarist/output/file.txt'), 'данные');
  await store.command({ kind: 'rename', projectId: project.id, name: 'После' });
  await assert.rejects(stat(root), { code: 'ENOENT' });
  const reopened = await StudioStore.open(store.folder);
  const saved = reopened.bootstrap().projects[0];
  assert.equal(saved.id, project.id);
  assert.equal(saved.createdAt, project.createdAt);
  assert.equal(saved.name, 'После');
  assert.equal(saved.agents[0].profile.id, 'writer');
  assert.equal(
    (
      await loadOutput(
        await reopened.projects.directory(saved.id),
        'agents/scenarist/output/file.txt',
      )
    ).content,
    'данные',
  );
});

test('clone refuses symlinks instead of creating a copy that still writes into the original', async (t) => {
  const { store } = await fixture(t);
  const source = (await store.command({ kind: 'create', name: 'Ссылка', agents: [agent()] }))
    .projects[0];
  const root = await store.projects.directory(source.id);
  await writeFile(join(root, 'original.txt'), 'сохранить');
  await symlink(join(root, 'original.txt'), join(root, 'linked.txt'));
  await assert.rejects(
    store.command({ kind: 'clone', projectId: source.id, name: 'Небезопасная копия' }),
    /символическая ссылка/,
  );
  assert.equal(store.bootstrap().projects.length, 1);
  assert.equal(await readFile(join(root, 'original.txt'), 'utf8'), 'сохранить');
  await assert.rejects(stat(join(store.folder, 'projects/Небезопасная копия')), { code: 'ENOENT' });
});
test('delete is reversible after restart and never erases any source project files', async (t) => {
  const { store } = await fixture(t);
  const project = (await store.command({ kind: 'create', name: 'Вернуть', agents: [agent()] }))
    .projects[0];
  const directory = await store.projects.directory(project.id);
  await writeFile(join(directory, 'agents/scenarist/output/result.txt'), 'сохранить');
  await store.command({ kind: 'remove', projectId: project.id });
  const reopened = await StudioStore.open(store.folder);
  assert.equal(reopened.bootstrap().projects.length, 0);
  assert.equal(reopened.bootstrap().trashProjects[0].id, project.id);
  await reopened.command({ kind: 'restore', projectId: project.id });
  assert.equal(
    (
      await loadOutput(
        await reopened.projects.directory(project.id),
        'agents/scenarist/output/result.txt',
      )
    ).content,
    'сохранить',
  );
  assert.equal(reopened.bootstrap().trashProjects.length, 0);
});
test('existing folder collision and invalid names never overwrite files or register a project', async (t) => {
  const { store } = await fixture(t);
  await mkdir(join(store.folder, 'projects/Занято'));
  await writeFile(join(store.folder, 'projects/Занято/keep.txt'), 'keep');
  for (const name of ['Занято', '../escape', '.hidden', 'a/b', 'a\\b', 'a:b', '\0'])
    await assert.rejects(store.command({ kind: 'create', name, agents: [agent()] }));
  assert.equal(store.bootstrap().projects.length, 0);
  assert.equal(await readFile(join(store.folder, 'projects/Занято/keep.txt'), 'utf8'), 'keep');
});
test('refresh synchronizes stable IDs/order, archives removed agents, preserves files and updates profiles only by explicit choice', async (t) => {
  const { store } = await fixture(t);
  const project = (
    await store.command({ kind: 'create', name: 'Снимок', agents: [agent(), agent('orphan')] })
  ).projects[0];
  const root = await store.projects.directory(project.id);
  await writeFile(join(root, 'agents/scenarist/output/file.txt'), 'не менять');
  const changed = { ...agent(), name: 'Изменён' };
  for (let i = 0; i < 2; i++)
    await store.command({
      kind: 'update-agents',
      projectId: project.id,
      agents: [changed, agent('new')],
      updateExisting: false,
    });
  let saved = await store.projects.read(project.id);
  assert.deepEqual(
    saved.agents.map((agent) => agent.profile.id),
    ['writer', 'new'],
  );
  assert.equal(saved.agents[0].profile.name, 'Сценарист');
  assert.deepEqual(
    saved.archivedAgents?.map((item) => item.agent.profile.id),
    ['orphan'],
  );
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: [changed],
    updateExisting: true,
  });
  saved = await store.projects.read(project.id);
  assert.equal(saved.agents[0].profile.name, 'Изменён');
  assert.deepEqual(
    saved.agents.map((item) => item.profile.id),
    ['writer'],
  );
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: [],
    updateExisting: false,
  });
  assert.deepEqual((await store.projects.read(project.id)).agents, []);
  await store.command({
    kind: 'update-agents',
    projectId: project.id,
    agents: [agent('orphan'), changed],
    updateExisting: false,
  });
  saved = await store.projects.read(project.id);
  assert.deepEqual(
    saved.agents.map((item) => item.profile.id),
    ['orphan', 'writer'],
  );
  assert.equal(saved.agents[1].outputPath, 'agents/scenarist/output');
  assert.equal(await readFile(join(root, 'agents/scenarist/output/file.txt'), 'utf8'), 'не менять');
});
test('corrupt and future studio versions fail without overwriting the original bytes', async (t) => {
  const { store } = await fixture(t);
  const file = join(store.folder, '.pistudio/studio.json');
  for (const content of ['{broken', '{"schemaVersion":99,"sections":{}}']) {
    await writeFile(file, content);
    await assert.rejects(StudioStore.open(store.folder));
    assert.equal(await readFile(file, 'utf8'), content);
  }
});
test('a corrupt project is reported and left intact while valid projects still load', async (t) => {
  const { store } = await fixture(t);
  await store.command({ kind: 'create', name: 'Валидный', agents: [] });
  await mkdir(join(store.folder, 'projects/Сломан'));
  await writeFile(join(store.folder, 'projects/Сломан/project.json'), '{broken');
  const reopened = await StudioStore.open(store.folder);
  assert.equal(reopened.bootstrap().projects.length, 1);
  assert.match(reopened.bootstrap().warnings[0], /Сломан/);
  assert.equal(
    await readFile(join(store.folder, 'projects/Сломан/project.json'), 'utf8'),
    '{broken',
  );
});
test('output reads reject traversal, symlinks, binary text, huge text and files outside output', async (t) => {
  const { root, store } = await fixture(t);
  const project = (await store.command({ kind: 'create', name: 'Безопасность', agents: [agent()] }))
    .projects[0];
  const directory = await store.projects.directory(project.id);
  await writeFile(join(root, 'outside.txt'), 'outside');
  await symlink(join(root, 'outside.txt'), join(directory, 'agents/scenarist/output/link.txt'));
  await writeFile(join(directory, 'agents/scenarist/output/binary.txt'), Buffer.from([0, 2]));
  await writeFile(
    join(directory, 'agents/scenarist/output/large.txt'),
    Buffer.alloc(2 * 1024 * 1024 + 1, 65),
  );
  for (const path of [
    '../outside.txt',
    '/etc/passwd',
    'project.json',
    'agents/scenarist/output/../../project.json',
    'agents/scenarist/output/link.txt',
    'agents/scenarist/output/binary.txt',
    'agents/scenarist/output/large.txt',
  ])
    await assert.rejects(loadOutput(directory, path));
  await assert.rejects(safePath(directory, 'agents/scenarist/output/../sessions'));
  const entries = (await store.projects.read(project.id)).agents[0].entries;
  assert.equal(
    entries.some((entry) => entry.name === 'link.txt'),
    false,
  );
});
test('media responses stream byte ranges for seeking and reject non-media documents', async (t) => {
  const { store } = await fixture(t);
  const project = (await store.command({ kind: 'create', name: 'Медиа', agents: [agent()] }))
    .projects[0];
  const root = await store.projects.directory(project.id);
  const path = 'agents/scenarist/output/video.mp4';
  await writeFile(join(root, path), Buffer.from('0123456789'));
  const response = await mediaResponse(
    root,
    path,
    new Request('https://local/', { headers: { range: 'bytes=3-5' } }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 3-5/10');
  assert.equal(await response.text(), '345');
  const suffix = await mediaResponse(
    root,
    path,
    new Request('https://local/', { headers: { range: 'bytes=-2' } }),
  );
  assert.equal(await suffix.text(), '89');
  assert.equal(
    (
      await mediaResponse(
        root,
        path,
        new Request('https://local/', { headers: { range: 'bytes=90-' } }),
      )
    ).status,
    416,
  );
  assert.equal(
    (await mediaResponse(root, 'agents/scenarist/output/code.html', new Request('https://local/')))
      .status,
    415,
  );
});
test('serialized saves preserve independent sections and remember the chosen studio', async (t) => {
  const { root } = await fixture(t);
  const preferences = join(root, 'preferences.json');
  const service = new StudioService(preferences, join(root, 'default'));
  await service.serialize(() => service.open(join(root, 'chosen')));
  await Promise.all(
    ['piPath', 'baseInstruction'].map((section) =>
      service.serialize(async () =>
        (await service.load()).saveSection(section as 'piPath' | 'baseInstruction', section),
      ),
    ),
  );
  const reopened = new StudioService(preferences, join(root, 'default'));
  const store = await reopened.load();
  assert.equal(store.folder, await realpath(join(root, 'chosen')));
  assert.equal(store.bootstrap().sections.piPath, 'piPath');
  assert.equal(store.bootstrap().sections.baseInstruction, 'baseInstruction');
});

test('the first default studio is remembered even if a later application version changes its default', async (t) => {
  const { root } = await fixture(t);
  const preferences = join(root, 'last-workspace.json');
  const original = new StudioService(preferences, join(root, 'original-default'));
  const first = await original.load();
  const updated = new StudioService(preferences, join(root, 'new-default'));
  assert.equal((await updated.load()).folder, first.folder);
});

test('a stalled read times out and releases the queue for recovery actions', async (t) => {
  const { root } = await fixture(t);
  const service = new StudioService(join(root, 'preferences.json'), join(root, 'studio'));
  const stalled = service.serialize(() => withReadDeadline(() => new Promise<never>(() => {}), 10));
  const recovery = service.serialize(async () => 'can choose another folder');
  const [failure, success] = await Promise.allSettled([stalled, recovery]);
  assert.equal(failure.status, 'rejected');
  assert.deepEqual(success, { status: 'fulfilled', value: 'can choose another folder' });
});
