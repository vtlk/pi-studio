import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { deleteAgentData } from '../src/main/storage/deleteAgentData.ts';
import { ProjectReadViews } from '../src/main/storage/ProjectReadViews.ts';
import type { Agent } from '../src/shared/studio.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-clear-results-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(join(root, 'Studio'));
  const agents: Agent[] = ['artist', 'other'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  }));
  await store.saveSection('agents', agents);
  const project = (await store.command({ kind: 'create', name: 'Results', agents })).projects[0];
  const directory = await store.projects.directory(project.id);
  const output = join(directory, project.agents[0].outputPath);
  const history = join(directory, '.pistudio/sessions/artist/history.jsonl');
  await mkdir(join(output, 'nested'));
  await writeFile(join(output, 'nested/result.txt'), 'creative result');
  await writeFile(join(output, '.hidden'), 'hidden output');
  await writeFile(history, 'canonical transcript\n');
  await writeFile(join(directory, project.agents[1].outputPath, 'keep.txt'), 'other agent');
  await store.projects.updateRuntime(project.id, 'artist', 'ready', {
    id: 'original-session',
    path: '.pistudio/sessions/artist/history.jsonl',
    title: 'Original',
    createdAt: 1,
  });
  const request = {
    folder: store.folder,
    projectId: project.id,
    agentId: 'artist',
    target: 'files' as const,
  };
  return { root, store, project, directory, output, history, request };
}

test('clearing moves only the selected output, including hidden/nested items, and preserves sessions/settings/other agents', async (t) => {
  const f = await fixture(t);
  const document = await readFile(join(f.directory, 'project.json'));
  const settings = await readFile(join(f.store.folder, '.pistudio/studio.json'));
  const outside = join(f.root, 'outside.txt');
  await writeFile(outside, 'external original');
  await symlink(outside, join(f.output, 'external-link'));
  await mkdir(join(f.output, 'empty-folder'));
  const before = await f.store.projects.read(f.project.id);
  assert.deepEqual(before.agents[0].entries.map(({ name }) => name).sort(), [
    'empty-folder',
    'nested',
  ]);
  let calls = 0;
  const trash = join(f.root, 'FixtureTrash');
  const move = async (path: string) => {
    calls++;
    assert.equal(path, f.output);
    await rename(path, trash);
  };
  const cleared = await deleteAgentData(f.store, f.request, move);
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(f.output), []);
  assert.deepEqual(await readdir(join(trash, 'empty-folder')), []);
  assert.deepEqual(cleared.agents[0].entries, []);
  assert.deepEqual(cleared.agents[1].entries, before.agents[1].entries);
  assert.equal(await readFile(join(trash, 'nested/result.txt'), 'utf8'), 'creative result');
  assert.equal(await readFile(join(trash, '.hidden'), 'utf8'), 'hidden output');
  assert.equal(await readFile(outside, 'utf8'), 'external original');
  assert.equal(await readFile(f.history, 'utf8'), 'canonical transcript\n');
  assert.equal(
    await readFile(join(f.directory, f.project.agents[1].outputPath, 'keep.txt'), 'utf8'),
    'other agent',
  );
  assert.deepEqual(await readFile(join(f.directory, 'project.json')), document);
  assert.deepEqual(await readFile(join(f.store.folder, '.pistudio/studio.json')), settings);
  assert.equal(cleared.agents[0].session?.id, 'original-session');
  assert.equal(cleared.agents[0].runStatus, 'idle');
  await deleteAgentData(f.store, f.request, move);
  assert.equal(calls, 1, 'Repeated clearing of an empty directory creates no extra trash item');
});

test('wrong studio/agent and a symlinked output cannot trash unrelated files', async (t) => {
  const f = await fixture(t);
  let called = false;
  const trash = async () => {
    called = true;
  };
  await assert.rejects(() => deleteAgentData(f.store, { ...f.request, folder: f.root }, trash));
  await assert.rejects(() => deleteAgentData(f.store, { ...f.request, agentId: 'missing' }, trash));
  await assert.rejects(() =>
    deleteAgentData(f.store, { ...f.request, projectId: '../outside' }, trash),
  );
  const saved = join(f.root, 'original-output');
  await rename(f.output, saved);
  await symlink(saved, f.output);
  await assert.rejects(() => deleteAgentData(f.store, f.request, trash), /ссылк/);
  assert.equal(called, false);
  assert.equal(await readFile(join(saved, 'nested/result.txt'), 'utf8'), 'creative result');
});

test('an output walk started before a clear cannot restore cached directory entries', async (t) => {
  const f = await fixture(t);
  const views = new ProjectReadViews();
  const read = () => views.read(f.project, f.directory, () => f.project);
  assert.equal((await read()).agents[0].entries[0].name, 'nested');
  const stale = read();
  views.clearOutputs(f.project, 'artist');
  // The stale walk can still see directory metadata, but it cannot publish it.
  assert.deepEqual((await stale).agents[0].entries, []);
  assert.deepEqual(views.snapshot(f.project).agents[0].entries, []);
  assert.equal((await read()).agents[0].entries[0].name, 'nested', 'A new scan can show new data');
});

test('a rejected trash operation leaves every output and ready status intact', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      deleteAgentData(f.store, f.request, async () => {
        throw new Error('Trash unavailable');
      }),
    /Trash unavailable/,
  );
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
  assert.equal((await f.store.projects.read(f.project.id)).agents[0].runStatus, 'ready');
});

test('a successful trash response cannot hide an output directory that still exists', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    deleteAgentData(f.store, f.request, async () => {}),
    /остался в проекте/,
  );
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
});

for (const target of ['dialogue', 'all'] as const) {
  test(`${target}: removes sessions and binding persistently, preserves settings and the other agent`, async (t) => {
    const f = await fixture(t);
    const settings = await readFile(join(f.store.folder, '.pistudio/studio.json'));
    const sessions = join(f.directory, '.pistudio/sessions/artist');
    await writeFile(join(sessions, 'old-fork.jsonl'), 'old fork');
    await mkdir(join(sessions, 'nested'));
    await writeFile(join(sessions, 'nested/history.jsonl'), 'nested history');
    const before = await f.store.projects.read(f.project.id);
    const moved: string[] = [];
    const cleared = await deleteAgentData(f.store, { ...f.request, target }, async (path) => {
      moved.push(path);
      await rename(path, join(f.root, `Trash-${moved.length}`));
    });
    assert.deepEqual(moved, target === 'all' ? [f.output, sessions] : [sessions]);
    assert.deepEqual(await readdir(sessions), []);
    assert.equal(cleared.agents[0].session, undefined);
    assert.equal(cleared.agents[0].runStatus, 'idle');
    assert.deepEqual(cleared.agents[0].profile, f.project.agents[0].profile);
    assert.equal(cleared.agents[0].outputPath, f.project.agents[0].outputPath);
    if (target === 'all') {
      assert.deepEqual(await readdir(f.output), []);
      assert.deepEqual(cleared.agents[0].entries, []);
    } else {
      assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
      assert.deepEqual(cleared.agents[0].entries, before.agents[0].entries);
    }
    assert.equal(
      await readFile(join(f.directory, f.project.agents[1].outputPath, 'keep.txt'), 'utf8'),
      'other agent',
    );
    assert.deepEqual(await readFile(join(f.store.folder, '.pistudio/studio.json')), settings);
    const reopened = await StudioStore.open(f.store.folder);
    assert.equal((await reopened.projects.read(f.project.id)).agents[0].session, undefined);
    assert.equal(
      JSON.parse(await readFile(join(f.directory, 'project.json'), 'utf8')).agents[0].session,
      undefined,
    );
    await deleteAgentData(reopened, { ...f.request, target }, async () =>
      assert.fail('Empty folders must not be trashed'),
    );
  });
}

test('invalid deletion target and unsafe sessions leave the binding and files intact', async (t) => {
  const f = await fixture(t);
  const document = await readFile(join(f.directory, 'project.json'));
  await assert.rejects(() =>
    deleteAgentData(f.store, { ...f.request, target: 'bad' as 'all' }, async () =>
      assert.fail('No trash for an invalid target'),
    ),
  );
  const sessions = join(f.directory, '.pistudio/sessions/artist');
  const saved = join(f.root, 'saved-sessions');
  await rename(sessions, saved);
  await symlink(saved, sessions);
  await assert.rejects(
    () =>
      deleteAgentData(f.store, { ...f.request, target: 'all' }, async () =>
        assert.fail('Both paths validate before deletion'),
      ),
    /ссылк/,
  );
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
  assert.equal(await readFile(join(saved, 'history.jsonl'), 'utf8'), 'canonical transcript\n');
  assert.deepEqual(await readFile(join(f.directory, 'project.json')), document);
});

test('a previously missing transcript can be reset to allow a new explicit launch', async (t) => {
  const f = await fixture(t);
  await rm(join(f.directory, '.pistudio/sessions/artist'), { recursive: true });
  const cleared = await deleteAgentData(f.store, { ...f.request, target: 'dialogue' }, async () =>
    assert.fail('Nothing to trash'),
  );
  assert.equal(cleared.agents[0].session, undefined);
  assert.deepEqual(await readdir(join(f.directory, '.pistudio/sessions/artist')), []);
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
});

test('dialogue deletion refuses a verified foreign Pi lease before moving either folder', async (t) => {
  const f = await fixture(t);
  const bridge = join(f.root, 'session.mjs');
  await writeFile(bridge, 'setInterval(()=>{},1000);');
  const child = spawn(process.execPath, [bridge, 'foreign-run'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => {
    child.kill();
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await writeFile(
    join(f.directory, 'agents/artist/.pistudio-session-lock.json'),
    JSON.stringify({ pid: child.pid, runId: 'foreign-run' }),
  );
  await assert.rejects(
    () =>
      deleteAgentData(f.store, { ...f.request, target: 'all' }, async () =>
        assert.fail('Live foreign Pi must not lose files'),
      ),
    /другом процессе Pi/,
  );
  assert.equal(child.exitCode, null);
  assert.equal(await readFile(f.history, 'utf8'), 'canonical transcript\n');
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
  assert.equal(
    (await f.store.projects.read(f.project.id)).agents[0].session?.id,
    'original-session',
  );
});
