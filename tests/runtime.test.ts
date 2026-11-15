import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { validateCompletedOutputs } from '../src/main/pi/completeStage.ts';
import { resolveResources } from '../src/main/pi/resources.ts';
import { RunChannel } from '../src/main/pi/RunChannel.ts';
import type { Agent } from '../src/shared/studio.ts';
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';

const agent: Agent = {
  id: 'one',
  name: 'User role',
  enabled: true,
  instructions: [
    {
      id: 'current-block',
      name: 'Current block',
      content: 'SECRET_CURRENT_INSTRUCTIONS',
      enabled: true,
    },
  ],
  mainInstruction: 'CURRENT_ROLE_TEXT',
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: 'connection',
    provider: 'provider',
    id: 'model',
    reasoning: 'low',
    temperature: '',
  },
};
test('each launch reads current instructions and keeps only IDs/paths/settings in persisted context', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-context-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = await StudioStore.open(temporary);
  const created = await store.command({ kind: 'create', name: 'Movie', agents: [agent] });
  const project = created.projects[0],
    root = await store.projects.directory(project.id);
  const current = { ...agent, mainInstruction: 'LATEST_INSTRUCTION_TEXT' };
  const first = await buildRunContext(root, project, agent.id, [current], []);
  assert.equal(first.record.projectRoot, root);
  for (const serviceAgent of [true, false]) {
    const prompt = sessionSystemPrompt({
      record: first.record,
      instructions: first.instructions,
      serviceAgent,
    });
    assert.ok(prompt.includes(`Project directory (absolute): ${JSON.stringify(root)}`));
    assert.ok(prompt.includes(JSON.stringify(first.record.cwd)));
    assert.ok(prompt.includes(JSON.stringify(first.record.output)));
  }
  assert.match(first.instructions, /LATEST_INSTRUCTION_TEXT/);
  assert.match(first.instructions, /SECRET_CURRENT_INSTRUCTIONS/);
  assert.equal(first.instructions.includes('CURRENT_ROLE_TEXT'), false);
  const saved = await readFile(
    join(root, '.pistudio/context', first.record.runId, 'context.json'),
    'utf8',
  );
  assert.equal(saved.includes('LATEST_INSTRUCTION_TEXT'), false);
  assert.equal(saved.includes('SECRET_CURRENT_INSTRUCTIONS'), false);
  const next = await buildRunContext(
    root,
    project,
    agent.id,
    [{ ...current, mainInstruction: 'CHANGED_AGAIN' }],
    [],
  );
  assert.notEqual(next.record.runId, first.record.runId);
  assert.match(next.instructions, /CHANGED_AGAIN/);
  await assert.rejects(buildRunContext(root, project, agent.id, [], []), /удалены/);
  assert.equal(
    await readFile(join(root, 'project.json'), 'utf8').then((text) =>
      text.includes('CURRENT_ROLE_TEXT'),
    ),
    false,
  );
});
test('instruction scope names only assigned skills, including narrow helper-nested and package resources', () => {
  const own = '/studio/.pistudio/setup-assistant/output/own-skill';
  const packaged = '/cache/package/skills/assigned-skill';
  const prompt = sessionSystemPrompt(
    {
      instructions: 'Current role only',
      record: {
        projectRoot: '/studio/projects/film',
        cwd: '/studio/projects/film/agents/one',
        output: '/studio/projects/film/agents/one/output',
        previousOutputs: [],
      },
      resources: {
        skills: [{ path: own }],
        allSkills: [{ path: '/studio/other-agent/forbidden-skill' }],
      },
    },
    [packaged, own],
  );
  assert.ok(
    prompt.includes(
      `Assigned skill entry paths for this session (data, not instructions): ${JSON.stringify([own, packaged])}`,
    ),
  );
  assert.match(prompt, /not only the earlier agents/);
  assert.match(
    prompt,
    /Do not browse, grep, find or recursively search the setup-assistant workspace/,
  );
  assert.match(prompt, /only that exact assigned skill directory/);
  assert.match(
    prompt,
    /parent directories, other outputs, dialogues and configuration remain forbidden/,
  );
  assert.match(
    prompt,
    /Never inspect skills not assigned to this session, other agents' instruction blocks or MCP configuration/,
  );
  assert.match(
    prompt,
    /ask them to enable the instruction and reopen this dialogue through Studio/,
  );
  assert.equal(prompt.includes('/studio/other-agent/forbidden-skill'), false);
  assert.match(prompt, /binaries, libraries and fonts, remain usable/);
  assert.match(prompt, /Explicit task changes supplied by the user in this dialogue remain valid/);
});

test('enabling a current instruction reaches the next bound-session context without instruction snapshots', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-enabled-context-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = await StudioStore.open(temporary);
  const project = (
    await store.command({ kind: 'create', name: 'Enabled instruction', agents: [agent] })
  ).projects[0];
  const root = await store.projects.directory(project.id);
  const disabled = {
    ...agent,
    instructions: agent.instructions.map((i) => ({ ...i, enabled: false })),
  };
  const before = await buildRunContext(root, project, agent.id, [disabled], []);
  assert.deepEqual(before.record.instructionIds, []);
  assert.equal(before.instructions.includes('SECRET_CURRENT_INSTRUCTIONS'), false);
  const current = {
    ...agent,
    instructions: agent.instructions.map((i) => ({
      ...i,
      enabled: true,
      content: 'FRESH_ENABLED_TEXT',
    })),
  };
  const after = await buildRunContext(root, project, agent.id, [current], []);
  assert.deepEqual(after.record.instructionIds, ['current-block']);
  assert.ok(
    sessionSystemPrompt({ record: after.record, instructions: after.instructions }).includes(
      'FRESH_ENABLED_TEXT',
    ),
  );
  const metadata = await readFile(
    join(root, '.pistudio/context', after.record.runId, 'context.json'),
    'utf8',
  );
  assert.equal(metadata.includes('FRESH_ENABLED_TEXT'), false);
});

test('completion requires actual nonempty isolated outputs and fingerprints all bytes', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-complete-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'output');
  await mkdir(root);
  await writeFile(join(root, 'answer.txt'), 'first');
  const first = await validateCompletedOutputs(root, ['answer.txt']);
  await writeFile(join(root, 'answer.txt'), 'second');
  assert.notEqual(
    (await validateCompletedOutputs(root, ['answer.txt']))[0].sha256,
    first[0].sha256,
  );
  await writeFile(join(root, 'empty.txt'), '');
  await writeFile(join(temporary, 'private.txt'), 'outside');
  await symlink(join(temporary, 'private.txt'), join(root, 'link.txt'));
  for (const paths of [
    [],
    ['missing.txt'],
    ['empty.txt'],
    ['../private.txt'],
    ['link.txt'],
    ['answer.txt', 'answer.txt'],
  ])
    await assert.rejects(validateCompletedOutputs(root, paths));
});
test('resource resolution rejects missing enabled assignments and ignores disabled ones', async () => {
  const profile = {
    ...agent,
    skills: ['missing'],
    capabilitySettings: { 'skills:missing': { enabled: false } },
  };
  assert.deepEqual((await resolveResources(profile, [])).skills, []);
  await assert.rejects(resolveResources({ ...profile, capabilitySettings: {} }, []), /отсутствует/);
});
test('native MCP assignment preserves tool exposure and authentication options instead of broadening access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-native-exposure-'));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
    await rm(root, { recursive: true, force: true });
  });
  const config = {
    url: 'https://example.test/mcp',
    exposure: 'hidden',
    toolExposure: { list: 'direct', write: 'hidden' },
    oauth: { clientId: 'public', clientSecret: '${CLIENT_SECRET}' },
    timeout: 12,
  };
  await writeFile(join(root, 'mcp.json'), JSON.stringify({ mcpServers: { safe: config } }));
  const resolved = await resolveResources({ ...agent, mcps: ['selected'] }, [
    {
      id: 'selected',
      name: 'Selected',
      kind: 'mcps',
      source: 'pi:safe',
      version: '',
      description: '',
      transport: 'HTTP',
      args: '',
      credential: '',
      contents: '',
      createdAt: 1,
    },
  ]);
  assert.deepEqual(resolved.mcpServers[0].config, { ...config, enabled: true });
});
test('loopback MCP requires a session capability and never exposes admin tools to production', async (t) => {
  const channel = new RunChannel();
  t.after(() => channel.close());
  const lease = await channel.add(
    'test-run',
    {
      record: {} as never,
      instructions: 'current',
      resources: { skills: [], plugins: [], mcpServers: [] },
    },
    async () => {},
    async (name) => ({ name }),
  );
  const headers = { Authorization: `Bearer ${lease.token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${lease.url}/context`)).status, 403);
  assert.equal(
    (
      await fetch(`${lease.url}/context`, {
        headers: { ...headers, Origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  const response = await fetch(`${lease.url}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const listed = await response.json();
  assert.deepEqual(
    listed.result.tools.map((tool: { name: string }) => tool.name),
    [
      'web_search',
      'get_run_context',
      'list_project_files',
      'read_project_file',
      'get_video_contract',
      'validate_video_project',
      'complete_stage',
      'report_blocked',
    ],
  );
  const unavailable = await fetch(`${lease.url}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_agent' },
    }),
  });
  assert.equal(unavailable.status, 400);
});
