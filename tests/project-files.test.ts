import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listProjectFiles, readProjectFile } from '../src/main/pi/projectFiles.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';
import type { Agent } from '../src/shared/studio.ts';

test('session MCP reads earlier agents and project metadata, with bounded UTF-8/binary windows', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-project-files-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'current');
  await mkdir(join(root, 'agents/previous/output'), { recursive: true });
  const path = 'agents/previous/output/brief.md';
  const text = '🙂Привет, следующий агент.\n';
  await writeFile(join(root, path), text);
  await writeFile(join(root, 'project.json'), '{"name":"Текущий проект"}');
  await writeFile(join(root, 'binary.dat'), Buffer.from([0, 255, 1, 2, 3]));
  const lifecycle = new RunLifecycle({} as never);
  const live = { run: { projectRoot: root } } as never;
  const listed = await lifecycle.tool(live, 'list_project_files', {
    path: 'agents/previous/output',
  });
  assert.equal(listed.entries[0].path, path);
  assert.equal(listed.entries[0].readable, true);
  let content = '',
    offset: number | null = 0;
  while (offset !== null) {
    const result = await lifecycle.tool(live, 'read_project_file', { path, offset, maxBytes: 5 });
    assert.equal(result.encoding, 'utf8');
    assert.ok(result.bytesRead <= 5 && result.bytesRead > 0);
    content += result.content;
    offset = result.nextOffset;
  }
  assert.equal(content, text);
  assert.equal(
    (await readProjectFile(root, { path: 'project.json' })).content,
    '{"name":"Текущий проект"}',
  );
  const binary = await readProjectFile(root, { path: 'binary.dat', maxBytes: 4 });
  assert.equal(binary.encoding, 'base64');
  assert.deepEqual(Buffer.from(binary.content, 'base64'), Buffer.from([0, 255, 1, 2]));
  assert.equal(binary.nextOffset, 4);
  assert.equal(
    await readFile(join(root, path), 'utf8'),
    text,
    'reads never modify the other agent result',
  );
  const page1 = await listProjectFiles(root, { limit: 2 });
  const page2 = await listProjectFiles(root, { limit: 2, offset: page1.nextOffset });
  assert.equal(page1.total, 3);
  assert.equal(new Set([...page1.entries, ...page2.entries].map((item) => item.path)).size, 3);
  assert.equal(page2.nextOffset, null);
});
test('project MCP rejects other projects, symlinks and excessive read requests; helper has scoped Project file tools', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-project-scope-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'current');
  await mkdir(root);
  await mkdir(join(temporary, 'other'));
  await writeFile(join(temporary, 'other/private.txt'), 'Other project');
  await symlink(join(temporary, 'other'), join(root, 'linked'));
  await symlink(join(temporary, 'other/private.txt'), join(root, 'file.txt'));
  for (const path of [
    '../other/private.txt',
    join(temporary, 'other/private.txt'),
    'linked/private.txt',
    'file.txt',
    'a/../../other/private.txt',
    'x\0',
  ])
    await assert.rejects(readProjectFile(root, { path }));
  for (const path of ['../other', join(temporary, 'other'), 'linked'])
    await assert.rejects(listProjectFiles(root, { path }));
  assert.equal(
    (await listProjectFiles(root, {})).entries.every((entry) => !entry.readable),
    true,
  );
  await assert.rejects(readProjectFile(root, { path: 'file.txt', maxBytes: 262145 }));
  await assert.rejects(listProjectFiles(root, { limit: 501 }));
  assert.equal(
    setupTools.some((tool) => ['read_project_file', 'list_project_files'].includes(tool.name)),
    true,
  );
});
test('every agent launch/resume/clone gets the current explicit project directory in its system prompt', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-prompt-path-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const agents: Agent[] = ['first', 'second'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      connectionId: 'test',
      provider: 'test',
      id: 'test',
      reasoning: 'low',
      temperature: '',
    },
  }));
  const store = await StudioStore.open(temporary);
  const created = await store.command({ kind: 'create', name: 'Original', agents });
  const original = created.projects[0];
  const cloned = await store.command({ kind: 'clone', projectId: original.id, name: 'Copy' });
  for (const project of cloned.projects) {
    const root = await store.projects.directory(project.id);
    for (const agent of agents) {
      const first = await buildRunContext(root, project, agent.id, agents, []);
      const resumed = await buildRunContext(root, project, agent.id, agents, []);
      assert.notEqual(first.record.runId, resumed.record.runId);
      for (const run of [first, resumed]) {
        const prompt = sessionSystemPrompt({ record: run.record, instructions: run.instructions });
        assert.ok(prompt.includes(`Project directory (absolute): ${JSON.stringify(root)}`));
        assert.ok(prompt.includes(JSON.stringify(join(root, 'agents', agent.id))));
        if (project.id !== original.id) assert.equal(prompt.includes('/projects/Original'), false);
      }
    }
  }
});
