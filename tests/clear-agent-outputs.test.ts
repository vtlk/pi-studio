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
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { clearAgentOutputs } from '../src/main/storage/clearAgentOutputs.ts';
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
  const history = join(directory, 'agents/artist/sessions/history.jsonl');
  await mkdir(join(output, 'nested'));
  await writeFile(join(output, 'nested/result.txt'), 'creative result');
  await writeFile(join(output, '.hidden'), 'hidden output');
  await writeFile(history, 'canonical transcript\n');
  await writeFile(join(directory, project.agents[1].outputPath, 'keep.txt'), 'other agent');
  await store.projects.updateRuntime(project.id, 'artist', 'ready', {
    id: 'original-session',
    path: 'agents/artist/sessions/history.jsonl',
    title: 'Original',
    createdAt: 1,
  });
  const request = { folder: store.folder, projectId: project.id, agentId: 'artist' };
  return { root, store, project, directory, output, history, request };
}

test('clearing moves only the selected output, including hidden/nested items, and preserves sessions/settings/other agents', async (t) => {
  const f = await fixture(t);
  const document = await readFile(join(f.directory, 'project.json'));
  const settings = await readFile(join(f.store.folder, '.pistudio/studio.json'));
  const outside = join(f.root, 'outside.txt');
  await writeFile(outside, 'external original');
  await symlink(outside, join(f.output, 'external-link'));
  let calls = 0;
  const trash = join(f.root, 'FixtureTrash');
  const move = async (path: string) => {
    calls++;
    assert.equal(path, f.output);
    await rename(path, trash);
  };
  const cleared = await clearAgentOutputs(f.store, f.request, move);
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(f.output), []);
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
  await clearAgentOutputs(f.store, f.request, move);
  assert.equal(calls, 1, 'Repeated clearing of an empty directory creates no extra trash item');
});

test('wrong studio/agent and a symlinked output cannot trash unrelated files', async (t) => {
  const f = await fixture(t);
  let called = false;
  const trash = async () => {
    called = true;
  };
  await assert.rejects(() => clearAgentOutputs(f.store, { ...f.request, folder: f.root }, trash));
  await assert.rejects(() =>
    clearAgentOutputs(f.store, { ...f.request, agentId: 'missing' }, trash),
  );
  await assert.rejects(() =>
    clearAgentOutputs(f.store, { ...f.request, projectId: '../outside' }, trash),
  );
  const saved = join(f.root, 'original-output');
  await rename(f.output, saved);
  await symlink(saved, f.output);
  await assert.rejects(() => clearAgentOutputs(f.store, f.request, trash), /ссылк/);
  assert.equal(called, false);
  assert.equal(await readFile(join(saved, 'nested/result.txt'), 'utf8'), 'creative result');
});

test('a rejected trash operation leaves every output and ready status intact', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      clearAgentOutputs(f.store, f.request, async () => {
        throw new Error('Trash unavailable');
      }),
    /Trash unavailable/,
  );
  assert.equal(await readFile(join(f.output, 'nested/result.txt'), 'utf8'), 'creative result');
  assert.equal((await f.store.projects.read(f.project.id)).agents[0].runStatus, 'ready');
});
