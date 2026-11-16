import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { TeamSupport } from '../src/main/team-mcp/TeamSupport.ts';
import { TeamJournal, messageId, messageHash } from '../src/main/team-mcp/TeamJournal.ts';
import { teamMcpId, builtinResource } from '../src/shared/builtinResources.ts';
import { teamScope, recipient } from '../src/main/team-mcp/scope.ts';
import { waitForTeamMessage } from '../src/main/team-mcp/wait.ts';
import type { TeamMessage } from '../src/main/team-mcp/types.ts';
import type { Agent } from '../src/shared/studio.ts';

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-team-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const agents: Agent[] = ['a', 'b'].map((id) => ({
    id,
    name: id,
    enabled: true,
    skills: [],
    mcps: [teamMcpId],
    plugins: [],
    mainInstruction: `ROLE_${id}`,
    instructions: [
      { id: 'enabled-' + id, name: 'Enabled', content: 'FULL_ENABLED_TEXT', enabled: true },
      { id: 'disabled-' + id, name: 'Disabled', content: 'FULL_DISABLED_TEXT', enabled: false },
    ],
    model: {
      connectionId: 'connection',
      provider: 'local',
      id: 'test-model',
      reasoning: 'По умолчанию',
      temperature: '',
    },
  }));
  await store.saveSection('agentCatalog', {
    agents,
    teams: [{ id: 'team', name: 'Team', agentIds: ['a', 'b'] }],
  });
  await store.saveSection('connections', [
    {
      id: 'connection',
      name: 'Local test',
      purpose: 'local',
      providerId: 'local',
      endpoint: 'http://localhost/?token=NEVER_EXPOSE',
      account: 'NEVER_EXPOSE',
      createdAt: 1,
    },
  ]);
  const project = (await store.command({ kind: 'create', name: 'Scoped', agents, teamId: 'team' }))
    .projects[0];
  const directory = await store.projects.directory(project.id);
  const run = await buildRunContext(directory, project, 'a', agents, []);
  const support = new TeamSupport(service);
  t.after(() => support.close());
  return { root, store, service, agents, project, directory, run, support };
}

test('team is optional, fresh native remains empty; removal revokes next-open tools and context exception', async (t) => {
  const f = await fixture(t);
  assert.equal(builtinResource(teamMcpId)?.source, 'builtin:team');
  assert.equal(f.support.groups(f.run)[0].name, 'team');
  assert.deepEqual(f.run.resources.mcpServers, [], 'App-owned MCP is injected only by scoped host');
  f.agents[0].mcps = [];
  const fresh = await buildRunContext(f.directory, f.project, 'a', f.agents, []);
  assert.equal(fresh.teamAccess, false);
  assert.deepEqual(f.support.groups(fresh), []);
  await assert.rejects(f.support.call(fresh, 'list_agents', {}), /не назначен/);
});

test('saved unlink revokes every existing team transport call; other agent and reattachment remain independent', async (t) => {
  const f = await fixture(t);
  const transport = f.support.groups(f.run)[0];
  const otherRun = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
  const other = f.support.groups(otherRun)[0];
  const signal = new AbortController().signal;
  const projectBefore = await readFile(join(f.directory, 'project.json'));
  await transport.call('list_agents', {}, signal);
  const catalog = f.store.agentCatalog();
  await f.store.saveSection('agentCatalog', {
    ...catalog,
    agents: catalog.agents.map((agent) => (agent.id === 'a' ? { ...agent, mcps: [] } : agent)),
  });
  for (const tool of transport.tools)
    await assert.rejects(
      transport.call(tool.name, {}, signal),
      /MCP team отключён или больше не назначен/,
    );
  await other.call('list_agents', {}, signal);
  assert.deepEqual(await readFile(join(f.directory, 'project.json')), projectBefore);
  assert.equal(builtinResource(teamMcpId)?.source, 'builtin:team');
  await f.store.saveSection('agentCatalog', catalog);
  await transport.call('list_agents', {}, signal);
  await f.store.saveSection('agentCatalog', {
    ...catalog,
    agents: catalog.agents.map((agent) =>
      agent.id === 'a'
        ? { ...agent, capabilitySettings: { [`mcps:${teamMcpId}`]: { enabled: false } } }
        : agent,
    ),
  });
  await assert.rejects(transport.call('list_agents', {}, signal), /MCP team отключён/);
  await other.call('list_agents', {}, signal);
});

test('read settings returns full current blocks and distinguishable runtime, no credentials or mutations', async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.store.folder, '.pistudio/studio.json'), 'utf8');
  const contexts = await readdir(join(f.directory, '.pistudio/context'));
  const result = (await f.support.call(f.run, 'read_agent_settings', { agent_id: 'b' })) as Record<
    string,
    unknown
  >;
  const text = JSON.stringify(result);
  assert.ok(
    text.includes('ROLE_b') &&
      text.includes('FULL_ENABLED_TEXT') &&
      text.includes('FULL_DISABLED_TEXT'),
  );
  assert.ok(text.includes(f.directory));
  assert.ok(text.includes('appliedToOpenSession'));
  assert.equal(result.appliedRuntime, null);
  assert.equal(text.includes('NEVER_EXPOSE'), false);
  assert.equal(await readFile(join(f.store.folder, '.pistudio/studio.json'), 'utf8'), before);
  assert.deepEqual(await readdir(join(f.directory, '.pistudio/context')), contexts);
  await assert.rejects(
    f.support.call(f.run, 'read_agent_settings', { agent_id: 'other-project' }),
    /участников/,
  );
  const unbound = { ...f.run, project: { ...f.project, sourceTeamId: undefined } };
  await assert.rejects(f.support.call(unbound, 'list_agents', {}), /привязки/);
});

test('output windows preserve all UTF-8/binary bytes; folders first, fingerprint changes and escape fail', async (t) => {
  const f = await fixture(t);
  const output = join(f.directory, f.project.agents[1].outputPath);
  await writeFile(join(output, 'first.txt'), 'Привет 🌍\n'.repeat(7));
  await mkdir(join(output, 'nested'));
  const binary = Buffer.from(Array.from({ length: 333 }, (_, i) => i % 256));
  await writeFile(join(output, 'nested/binary.bin'), binary);
  const listing = (await f.support.call(f.run, 'list_output', { agent_id: 'b', limit: 1 })) as {
    entries: { name: string }[];
    nextOffset: number;
  };
  assert.equal(listing.entries[0].name, 'nested');
  assert.equal(listing.nextOffset, 1);
  for (const [path, expected] of [
    ['first.txt', await readFile(join(output, 'first.txt'))],
    ['nested/binary.bin', binary],
  ] as const) {
    let offset: number | null = 0;
    let fingerprint: string | undefined;
    const buffers = [];
    while (offset !== null) {
      const part = (await f.support.call(f.run, 'read_output', {
        agent_id: 'b',
        path,
        offset,
        max_bytes: 7,
        fingerprint,
      })) as {
        encoding: BufferEncoding;
        content: string;
        fingerprint: string;
        nextOffset: number | null;
      };
      buffers.push(Buffer.from(part.content, part.encoding));
      fingerprint = part.fingerprint;
      offset = part.nextOffset;
    }
    assert.deepEqual(Buffer.concat(buffers), expected);
    await writeFile(join(output, path), 'changed');
    await assert.rejects(
      f.support.call(f.run, 'read_output', { agent_id: 'b', path, fingerprint }),
      /изменился/,
    );
  }
  await symlink(f.directory, join(output, 'escape'));
  for (const path of [
    '../sessions/private.jsonl',
    '/etc/passwd',
    'escape/project.json',
    'nested/../../project.json',
    'C:\\secret',
  ])
    await assert.rejects(f.support.call(f.run, 'read_output', { agent_id: 'b', path }));
});

test('names never select first; missing snapshot/team/disabled recipients fail without launching', async (t) => {
  const f = await fixture(t);
  const scope = await teamScope(f.service, f.run);
  scope.catalog.agents[1].name = 'a';
  assert.throws(() => recipient(scope, { agent_name: 'a' }), /Неоднозначное.*a, b/);
  assert.equal(recipient(scope, { agent_id: 'b' }).current.id, 'b');
  scope.project.agents.pop();
  assert.throws(() => recipient(scope, { agent_id: 'b' }), /Перечитать/);
  scope.team = undefined;
  assert.throws(() => recipient(scope, { agent_id: 'b' }), /удалена/);
  await assert.rejects(
    f.support.call(f.run, 'say_to_agent', { agent_id: 'a', text: 'self', request_id: 'self' }),
    /Самопосылка/,
  );
});

function message(
  projectId: string,
  senderId: string,
  recipientId: string,
  requestId: string,
): TeamMessage {
  return {
    version: 1,
    id: messageId(projectId, senderId, requestId),
    requestId,
    projectId,
    sourceTeamId: 'team',
    senderId,
    recipientId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: 'queued',
    text: 'task',
    bodyHash: messageHash('task'),
    lineage: [senderId],
  };
}
test('journal persists FIFO/idempotency, detects independent cycles and never keeps dispatched task text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-team-journal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new TeamJournal(root, 'project');
  const first = message('project', 'a', 'b', 'one');
  const persisted = await journal.accept(first);
  assert.deepEqual(await journal.accept(first), persisted);
  await assert.rejects(journal.accept({ ...first, bodyHash: 'different' }), /уже использован/);
  await assert.rejects(journal.accept(message('project', 'b', 'a', 'cycle')), /цикл/);
  const second = { ...message('project', 'a', 'c', 'fifo'), createdAt: first.createdAt };
  await journal.accept(second);
  assert.deepEqual(
    (await journal.list()).map((item) => item.id),
    [first.id, second.id],
    'FIFO is stable even when creation timestamps tie',
  );
  await journal.update(first.id, (previous) => ({
    ...previous,
    state: 'dispatching',
    dispatchHash: 'receipt',
  }));
  assert.equal((await journal.get(first.id))?.text, undefined);
  assert.equal(
    (await journal.accept(first)).state,
    'dispatching',
    'retry does not enqueue again after timeout',
  );
  const reopened = new TeamJournal(root, 'project');
  assert.equal((await reopened.list())[0].state, 'dispatching');
  const clone = new TeamJournal(root, 'clone');
  assert.deepEqual(await clone.list(), [], 'cloned journals never become runnable');
});

test('say_to wait remains pending while recipient executes; terminal states and cancellation unblock honestly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-team-wait-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new TeamJournal(root, 'project');
  const item = await journal.accept(message('project', 'a', 'b', 'wait'));
  const armed = new Set([item.id]);
  let resolved = false;
  const waiting = waitForTeamMessage(journal, armed, item.id, new AbortController().signal).then(
    (result) => {
      resolved = true;
      return result;
    },
  );
  await journal.update(item.id, (previous) => ({ ...previous, state: 'received' }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(resolved, false, 'sender cannot continue on accepted/received');
  await journal.update(item.id, (previous) => ({ ...previous, state: 'completed' }));
  assert.equal((await waiting).state, 'completed');
  const next = await journal.accept(message('project', 'a', 'b', 'cancel'));
  const abort = new AbortController();
  const cancelled = waitForTeamMessage(journal, new Set([next.id]), next.id, abort.signal);
  abort.abort();
  await assert.rejects(cancelled, /могло быть принято/);
  assert.equal(
    (await journal.get(next.id))?.state,
    'queued',
    'cancel wait never replays or cancels task silently',
  );
  assert.equal(
    (await waitForTeamMessage(journal, new Set(), next.id, new AbortController().signal))
      .requiresExplicitResume,
    true,
  );
});

test('busy queue survives restart without auto-launch; explicit same-key retry dispatches once and uncertainty never replays (host fixture)', async (t) => {
  const f = await fixture(t);
  let busy = true,
    launches = 0;
  const target = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
  const host = {
    inspect: () => undefined,
    teamUnavailable: () => (busy ? 'Получатель выполняет запрос.' : undefined),
    assertTeamDispatch: () => {},
    launchTeamTask: async (
      _projectId: string,
      _agentId: string,
      _text: string,
      _delivery: unknown,
      before: (run: typeof target) => Promise<void>,
    ) => {
      launches++;
      await before(target);
      throw new Error('Simulated uncertain terminal dispatch');
    },
  };
  f.support.attach(host);
  const args = { agent_id: 'b', text: 'Queued task', request_id: 'restart-key' };
  const accepted = (await f.support.call(f.run, 'say_to_agent', args)) as { id: string };
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(launches, 0);
  f.support.close();
  const restarted = new TeamSupport(f.service);
  restarted.attach(host);
  t.after(() => restarted.close());
  busy = false;
  const listed = (await restarted.call(f.run, 'list_agents', {})) as {
    pendingMessages: { requiresExplicitResume: boolean }[];
  };
  assert.equal(listed.pendingMessages[0].requiresExplicitResume, true);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(launches, 0, 'Restart/list/status never launches pending work');
  await restarted.call(f.run, 'say_to_agent', args);
  let state = '';
  for (let i = 0; i < 60; i++) {
    state = (
      (await restarted.call(f.run, 'message_status', { message_id: accepted.id })) as {
        state: string;
      }
    ).state;
    if (state === 'uncertain') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(state, 'uncertain');
  assert.equal(launches, 1);
  const repeated = (await restarted.call(f.run, 'say_to_agent', args)) as { state: string };
  assert.equal(repeated.state, 'uncertain');
  assert.equal(launches, 1);
});

test('questions remain gated across closing Pi and restart; only explicit manual input clears attention', async (t) => {
  const f = await fixture(t);
  const { observeAttention, needsUser } = await import('../src/main/team-mcp/attention.ts');
  const target = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
  const runtime = {
    run: target,
    status: 'waiting' as const,
    blocked: true,
    sequence: 1,
    opened: true,
    delivering: false,
  };
  const host = { inspect: () => runtime } as Parameters<typeof observeAttention>[2];
  await observeAttention(target, { type: 'settled' }, host);
  assert.equal(await needsUser(f.directory, 'b'), true);
  await observeAttention(target, { type: 'request', messageId: 'automatic' }, host);
  assert.equal(
    await needsUser(f.directory, 'b'),
    true,
    'Automatic delivery cannot clear a question',
  );
  await observeAttention(target, { type: 'request' }, host);
  assert.equal(await needsUser(f.directory, 'b'), false);
});

test('cancelling a queued task during preparation wins the final dispatch check (host fixture)', async (t) => {
  const f = await fixture(t);
  const { dispatchTeamMessage } = await import('../src/main/team-mcp/dispatch.ts');
  const journal = new TeamJournal(f.directory, f.project.id);
  const item = await journal.accept(message(f.project.id, 'a', 'b', 'cancel-race'));
  const target = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
  let terminalDispatch = 0;
  const host = {
    inspect: () => undefined,
    teamUnavailable: () => undefined,
    assertTeamDispatch: () => {},
    launchTeamTask: async (
      _projectId: string,
      _agentId: string,
      _text: string,
      _delivery: unknown,
      before: (run: typeof target) => Promise<void>,
    ) => {
      await journal.update(item.id, (previous) => ({ ...previous, state: 'cancelled' }));
      await before(target);
      terminalDispatch++;
    },
  };
  await dispatchTeamMessage(f.service, host, f.run, item, journal);
  assert.equal(terminalDispatch, 0);
  assert.equal((await journal.get(item.id))?.state, 'cancelled');
});

test('team deletion revokes the removed sender and preserves output files; chain conflicts reject before queue', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, f.project.agents[1].outputPath, 'keep.txt'), 'ARCHIVED_RESULT');
  f.support.attach({
    inspect: () => undefined,
    teamUnavailable: () => 'В проекте включена цепочка.',
    assertTeamDispatch: () => {},
    launchTeamTask: async () => {
      throw new Error('Must not launch');
    },
  });
  await assert.rejects(
    f.support.call(f.run, 'say_to_agent', { agent_id: 'b', text: 'Conflict', request_id: 'chain' }),
    /цепочка/,
  );
  assert.deepEqual(await f.support.projectMessages(f.project.id), []);
  await f.store.saveSection('agentCatalog', { agents: [], teams: [] });
  await assert.rejects(f.support.call(f.run, 'list_agents', {}), /MCP team отключён/);
  await assert.rejects(
    f.support.call(f.run, 'read_output', { agent_id: 'b', path: 'keep.txt' }),
    /MCP team отключён/,
  );
  assert.equal(
    await readFile(join(f.directory, f.project.agents[1].outputPath, 'keep.txt'), 'utf8'),
    'ARCHIVED_RESULT',
  );
  assert.deepEqual(await f.support.projectMessages(f.project.id), []);
  await assert.rejects(
    f.support.call(f.run, 'say_to_agent', {
      agent_id: 'b',
      text: 'Never fallback',
      request_id: 'gone',
    }),
    /MCP team отключён/,
  );
});
