import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import type { Agent } from '../src/shared/studio.ts';

const profile = (id: string): Agent => ({
  id,
  name: id,
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  mainInstruction: 'Current instructions must not be copied into project metadata.',
});

test('moving a project refuses a verified foreign Pi process, including archived agents; dead leases do not block', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-foreign-session-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = await StudioStore.open(temporary);
  const project = (
    await store.command({ kind: 'create', name: 'Original', agents: [profile('archived')] })
  ).projects[0];
  const root = await store.projects.directory(project.id);
  const cwd = join(root, 'agents/archived');
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'archived' });
  const bridge = join(temporary, 'session.mjs');
  await writeFile(bridge, 'setInterval(()=>{},1000);');
  const child = spawn(process.execPath, [bridge, 'foreign-run-id'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  t.after(() => child.kill());
  await writeFile(
    join(cwd, '.pistudio-session-lock.json'),
    JSON.stringify({ pid: child.pid, runId: 'foreign-run-id' }),
  );
  const metadata = await readFile(join(root, 'project.json'));
  for (const command of [{ kind: 'rename', name: 'Moved' }, { kind: 'remove' }] as const)
    await assert.rejects(store.command({ ...command, projectId: project.id }), /другой процесс Pi/);
  assert.equal(child.exitCode, null, 'Studio must not stop an unowned process');
  assert.deepEqual(await readFile(join(root, 'project.json')), metadata);
  child.kill();
  await exited;
  await store.command({ kind: 'rename', projectId: project.id, name: 'Moved' });
  assert.equal((await store.projects.read(project.id)).name, 'Moved');
});

test('clone preserves active/archived histories and attachments but excludes only process leases', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-clone-sessions-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = await StudioStore.open(temporary);
  const project = (
    await store.command({
      kind: 'create',
      name: 'Original',
      agents: [profile('one'), profile('two')],
    })
  ).projects[0];
  const root = await store.projects.directory(project.id);
  const histories = new Map<string, Buffer>();
  for (const agent of project.agents) {
    const directory = agent.outputPath.replace(/\/output$/, '');
    const path = `.pistudio/sessions/${agent.profile.id}/history.jsonl`;
    const bytes = Buffer.from(`{"type":"session","id":"${agent.profile.id}"}\n`);
    histories.set(path, bytes);
    await writeFile(join(root, path), bytes);
    await writeFile(
      join(root, directory, '.pistudio-session-lock.json'),
      JSON.stringify({ pid: process.pid, runId: 'source' }),
    );
    await writeFile(
      join(root, agent.outputPath, '.pistudio-session-lock.json'),
      'user output with the same name',
    );
    await store.projects.updateRuntime(project.id, agent.profile.id, 'running', {
      id: agent.profile.id,
      title: agent.profile.name,
      path,
      createdAt: 123,
    });
  }
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'two' });
  await mkdir(join(root, '.pistudio/attachments'), { recursive: true });
  const attachment = Buffer.from([0, 10, 255, 23]);
  await writeFile(join(root, '.pistudio/attachments/reference.bin'), attachment);
  const originalMetadata = await readFile(join(root, 'project.json'));
  const result = await store.command({ kind: 'clone', projectId: project.id, name: 'Copy' });
  const copy = result.projects.find((item) => item.id === result.selectedId)!;
  const copiedRoot = await store.projects.directory(copy.id);
  assert.notEqual(copy.id, project.id);
  assert.equal(copy.autoContinue, false);
  assert.equal(copy.archivedAgents?.[0].position, 1);
  for (const agent of [...copy.agents, ...copy.archivedAgents!.map((item) => item.agent)]) {
    assert.equal(agent.runStatus, undefined);
    assert.equal(agent.session?.needsFork, true);
    assert.equal(agent.session?.createdAt, 123);
    assert.deepEqual(
      await readFile(join(copiedRoot, agent.session!.path)),
      histories.get(agent.session!.path),
    );
    await assert.rejects(
      stat(join(copiedRoot, agent.outputPath, '..', '.pistudio-session-lock.json')),
      { code: 'ENOENT' },
    );
    assert.equal(
      await readFile(join(copiedRoot, agent.outputPath, '.pistudio-session-lock.json'), 'utf8'),
      'user output with the same name',
    );
    assert.ok(await stat(join(root, agent.outputPath, '..', '.pistudio-session-lock.json')));
  }
  assert.deepEqual(
    await readFile(join(copiedRoot, '.pistudio/attachments/reference.bin')),
    attachment,
  );
  assert.deepEqual(await readFile(join(root, 'project.json')), originalMetadata);
  assert.equal(
    (await readFile(join(copiedRoot, 'project.json'), 'utf8')).includes('Current instructions'),
    false,
  );
  assert.equal(
    (await StudioStore.open(temporary)).bootstrap().projects.find((item) => item.id === copy.id)!
      .agents[0].session?.needsFork,
    true,
  );
});

test('rename marks active and archived bindings for native fork while preserving history bytes and relative paths', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-rename-sessions-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = await StudioStore.open(temporary);
  const project = (
    await store.command({
      kind: 'create',
      name: 'Before',
      agents: [profile('one'), profile('two')],
    })
  ).projects[0];
  const root = await store.projects.directory(project.id);
  const history = Buffer.from('canonical Pi history\n');
  for (const agent of project.agents) {
    const path = `.pistudio/sessions/${agent.profile.id}/history.jsonl`;
    await writeFile(join(root, path), history);
    await store.projects.updateRuntime(project.id, agent.profile.id, 'stopped', {
      id: agent.profile.id,
      title: agent.profile.name,
      path,
      createdAt: 321,
    });
  }
  await store.command({ kind: 'remove-agent', projectId: project.id, agentId: 'two' });
  await mkdir(join(root, '.pistudio/attachments'), { recursive: true });
  await writeFile(join(root, '.pistudio/attachments/input.txt'), 'reference');
  for (const name of ['After', 'Again'])
    await store.command({ kind: 'rename', projectId: project.id, name });
  await assert.rejects(stat(root), { code: 'ENOENT' });
  const reopened = await StudioStore.open(temporary);
  const saved = reopened.bootstrap().projects[0];
  assert.equal(saved.id, project.id);
  assert.equal(saved.createdAt, project.createdAt);
  assert.equal(saved.name, 'Again');
  const newRoot = await reopened.projects.directory(project.id);
  assert.equal(
    await readFile(join(newRoot, '.pistudio/attachments/input.txt'), 'utf8'),
    'reference',
  );
  for (const agent of [...saved.agents, ...saved.archivedAgents!.map((item) => item.agent)]) {
    assert.equal(agent.session?.needsFork, true);
    assert.equal(agent.session?.createdAt, 321);
    assert.equal(
      agent.outputPath,
      project.agents.find((item) => item.profile.id === agent.profile.id)!.outputPath,
    );
    assert.deepEqual(await readFile(join(newRoot, agent.session!.path)), history);
  }
  await reopened.command({ kind: 'restore-agent', projectId: project.id, agentId: 'two' });
  assert.equal((await reopened.projects.read(project.id)).agents[1].session?.needsFork, true);
  // Collisions/invalid names must leave metadata, folder and histories untouched.
  await mkdir(join(temporary, 'projects/occupied'));
  const metadata = await readFile(join(newRoot, 'project.json'));
  for (const name of ['Occupied', '../escape'])
    await assert.rejects(reopened.command({ kind: 'rename', projectId: project.id, name }));
  assert.deepEqual(await readFile(join(newRoot, 'project.json')), metadata);
  assert.deepEqual((await readdir(join(temporary, 'projects'))).sort(), ['again', 'occupied']);
});
