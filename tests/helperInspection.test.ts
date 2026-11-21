import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { Resource } from '../src/shared/resources.ts';
import { saveManagedSkill } from '../src/main/storage/managedSkills.ts';

const agents: Agent[] = [
  {
    id: 'writer',
    name: 'Сценарист',
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction: 'Взгляд имеет приоритет',
    instructions: [
      { id: 'wide', name: 'Кадр', content: 'Использовать широкий план.', enabled: true },
      { id: 'disabled', name: 'Палитра', content: 'Сиреневый запрет.', enabled: false },
    ],
  },
  {
    id: 'artist',
    name: 'Художник',
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
    instructions: [],
  },
];

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'pistudio-helper-inspect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = new StudioService(join(dir, 'preferences.json'), join(dir, 'studio'));
  const store = await service.load();
  const helper = (store.bootstrap().sections.systemAgents as SystemAgent[])[0];
  const run = {
    projectRoot: join(store.folder, '.pistudio/setup-assistant'),
    project: { id: 'pi-setup-assistant' },
    record: { agentId: helper.id },
  } as PreparedRun;
  const admin = new SetupAdministration(service, async () => {
    throw Error('Unexpected catalog call');
  });
  return { store, run, admin };
}

test('helper resolves the exact project and reads only the selected agent’s files', async (t) => {
  const { store, run, admin } = await fixture(t);
  const first = await store.command({ kind: 'create', name: 'Мультфильм', agents });
  const project = first.projects.find(({ id }) => id === first.selectedId)!;
  const root = await store.projects.directory(project.id);
  const folder = join(root, project.agents[0].outputPath);
  const body = 'Здесь результат 🎬 и ещё немного текста.';
  await writeFile(join(folder, 'result.md'), body);
  await writeFile(join(folder, '.private'), 'PRIVATE');
  await symlink(join(root, 'project.json'), join(folder, 'escape.md'));
  const catalog = (await admin.call(run, 'list_projects', { query: 'МУЛЬТ' })) as any;
  assert.deepEqual(
    catalog.items.map(({ id }) => id),
    [project.id],
  );
  const members = (await admin.call(run, 'list_project_agents', { project: 'Мультфильм' })) as any;
  assert.deepEqual(
    members.items.map(({ id }) => id),
    ['writer', 'artist'],
  );
  const listed = (await admin.call(run, 'list_agent_results', {
    project: 'Мультфильм',
    agent: 'СЦЕНАРИСТ',
  })) as any;
  assert.deepEqual(
    listed.items.map(({ path }) => path),
    ['result.md'],
  );
  const target = { project: project.id, agent: 'writer', path: 'result.md', max_bytes: 9 };
  let data = '';
  let offset = 0;
  let fingerprint: string | undefined;
  while (true) {
    const chunk = (await admin.call(run, 'read_agent_result', {
      ...target,
      offset,
      fingerprint,
    })) as any;
    data += chunk.content;
    if (chunk.nextOffset === null) break;
    assert.ok(chunk.nextOffset > offset);
    offset = chunk.nextOffset;
    fingerprint = chunk.fingerprint;
  }
  assert.equal(data, body);
  assert.ok(!JSON.stringify(listed).includes(root));
  for (const path of ['../result.md', 'escape.md', '.private', join(folder, 'result.md')])
    await assert.rejects(admin.call(run, 'read_agent_result', { ...target, path }));
  await assert.rejects(admin.call(run, 'read_agent_result', { ...target, agent: 'artist' }));
  await assert.rejects(admin.call({ ...run, projectRoot: root }, 'read_agent_result', target));
  await store.command({
    kind: 'create',
    name: 'Другой проект',
    agents: [agents[0], { ...agents[1], name: agents[0].name }],
  });
  await assert.rejects(
    admin.call(run, 'list_agent_results', { project: 'Другой проект', agent: 'Сценарист' }),
    /ID/,
  );
  await store.command({ kind: 'remove', projectId: project.id });
  await assert.rejects(admin.call(run, 'read_agent_result', target));
});

test('helper attributes shared output to the agent’s latest validated completion', async (t) => {
  const { store, run, admin } = await fixture(t);
  const result = await store.command({
    kind: 'create',
    name: 'Общий',
    agents,
    workspaceMode: 'shared',
  });
  const root = await store.projects.directory(result.selectedId!);
  const report = join(root, '.pistudio/context/run-one');
  await mkdir(report, { recursive: true });
  await writeFile(join(root, 'writer.txt'), 'result');
  await writeFile(join(root, 'other.txt'), 'unrelated');
  await writeFile(
    join(report, 'context.json'),
    JSON.stringify({
      runId: 'run-one',
      projectId: result.selectedId,
      workspaceMode: 'shared',
      agentId: 'writer',
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(
    join(report, 'result.json'),
    JSON.stringify({
      runId: 'run-one',
      status: 'ready',
      outputs: [
        { path: 'writer.txt', size: 6 },
        { path: 'project.json', size: 1 },
      ],
    }),
  );
  const target = { project: result.selectedId, agent: 'writer' };
  const list = (await admin.call(run, 'list_agent_results', target)) as any;
  assert.deepEqual(
    list.items.map(({ path }) => path),
    ['writer.txt'],
  );
  const read = (await admin.call(run, 'read_agent_result', {
    ...target,
    path: 'writer.txt',
  })) as any;
  assert.equal(read.content, 'result');
  await copyFile(join(report, 'result.json'), join(report, 'agent-result.json'));
  await writeFile(
    join(report, 'result.json'),
    JSON.stringify({ runId: 'run-one', status: 'waiting', outputs: [] }),
  );
  const afterQuestion = (await admin.call(run, 'list_agent_results', target)) as any;
  assert.deepEqual(
    afterQuestion.items.map(({ path }) => path),
    ['writer.txt'],
  );
  for (const path of ['other.txt', 'project.json', '.pistudio/context/run-one/context.json'])
    await assert.rejects(admin.call(run, 'read_agent_result', { ...target, path }));
  await assert.rejects(
    admin.call(run, 'read_agent_result', { ...target, agent: 'artist', path: 'writer.txt' }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(root, 'writer.txt'), 'edited');
  await assert.rejects(admin.call(run, 'read_agent_result', { ...target, path: 'writer.txt' }));
});

test('settings search batches groups, respects scope and never returns native MCP configuration', async (t) => {
  const { store, run, admin } = await fixture(t);
  const skill = await saveManagedSkill(store, {
    folder: store.folder,
    name: 'review-skill',
    description: 'Safe',
    content: 'Оптический приоритет взгляда.',
  });
  const mcp: Resource = {
    id: 'review-mcp',
    kind: 'mcps',
    name: 'Редактор кадров',
    description: 'Широкий план',
    source: 'pi:review-tools',
    args: 'NEVER_RETURN_RAW_ARGS',
    credential: '',
    contents: '',
    transport: 'stdio',
    version: '',
    createdAt: 1,
  };
  await store.saveSection('resources', [skill, mcp]);
  await store.saveSection('agentCatalog', {
    agents: [
      { ...agents[0], skills: [skill.id], mcps: [mcp.id] },
      { ...agents[1], mainInstruction: 'Широкий план другой команды' },
    ],
    teams: [
      { id: 'selected-team', name: 'Выбранная', agentIds: ['writer'] },
      { id: 'other-team', name: 'Другая', agentIds: ['artist'] },
    ],
  });
  const search = {
    team_id: 'selected-team',
    sections: ['prompt', 'instructions', 'skills', 'mcps'],
    queries: [
      { id: 'wide', terms: ['ШИРОКИЙ', 'широкоформатный'] },
      { id: 'gaze', terms: ['взгляд', 'приоритет'], match: 'all' },
      { id: 'palette', terms: ['сиренев'] },
      { id: 'secret', terms: ['NEVER_RETURN_RAW_ARGS'] },
    ],
  };
  const page = (await admin.call(run, 'search_agent_settings', { ...search, limit: 2 })) as any;
  assert.deepEqual(page.queryMatchCounts, { wide: 2, gaze: 2, palette: 0, secret: 0 });
  assert.deepEqual(
    page.items.map(({ section }) => section),
    ['prompt', 'instructions'],
  );
  const next = (await admin.call(run, 'search_agent_settings', {
    ...search,
    ...page.nextPage.arguments,
  })) as any;
  assert.deepEqual(
    next.items.map(({ resourceId }) => resourceId),
    [skill.id, mcp.id],
  );
  const disabled = (await admin.call(run, 'search_agent_settings', {
    ...search,
    include_disabled: true,
  })) as any;
  assert.equal(
    disabled.items.find(({ instructionId }) => instructionId === 'disabled').enabled,
    false,
  );
  const oneSkill = (await admin.call(run, 'search_agent_settings', {
    resource_ids: [skill.id],
    query: 'оптический',
  })) as any;
  assert.equal(oneSkill.items[0].resourceId, skill.id);
  await assert.rejects(
    admin.call(run, 'search_agent_settings', { ...search, agent_ids: ['artist'] }),
  );
});
