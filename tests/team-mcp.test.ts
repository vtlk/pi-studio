import test from 'node:test';
import { readAllSettings } from './settingsRead.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { runTeamAccess } from '../src/main/pi/runTeamAccess.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import { dispatchTeamMessage } from '../src/main/team-mcp/dispatch.ts';
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
  const result = await readAllSettings<Record<string, unknown>>(
    (args) => f.support.call(f.run, 'read_agent_settings', args),
    { agent_id: 'b', include_derived_prompts: true },
  );
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
    chainCorrection: () => undefined,
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

test('legacy attention and saved waiting/error status never block a fresh explicit task, with or without a live recipient', async (t) => {
  for (const status of ['waiting', 'error', 'stopped'] as const) {
    for (const opened of [false, true]) {
      const f = await fixture(t);
      await f.store.projects.updateRuntime(f.project.id, 'b', status);
      const dir = join(f.directory, '.pistudio/team/attention');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'b.json'), JSON.stringify({ status: 'stopped', runId: 'old-run' }));
      const target = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
      let delivered = 0;
      f.support.attach({
        inspect: () =>
          opened
            ? { run: target, status, blocked: true, sequence: 5, opened: true, delivering: false }
            : undefined,
        chainCorrection: () => undefined,
        teamUnavailable: () => undefined,
        assertTeamDispatch: () => {},
        launchTeamTask: async (_p, _a, _text, _delivery, before) => {
          await before(target);
          delivered++;
        },
      });
      const result = (await f.support.call(f.run, 'say_to', {
        agent_id: 'b',
        text: 'NEW_EXPLICIT_TASK',
        request_id: 'fresh-after-old-status',
      })) as { id: string };
      for (let i = 0; i < 50 && !delivered; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(delivered, 1);
      assert.equal(
        (await new TeamJournal(f.directory, f.project.id).get(result.id))?.state,
        'dispatching',
      );
    }
  }
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
    chainCorrection: () => undefined,
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
    chainCorrection: () => {
      throw new Error('В проекте включена цепочка.');
    },
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

test('only the active chain request can send a correction to an earlier saved stage', async (t) => {
  const f = await fixture(t);
  const source = await buildRunContext(f.directory, f.project, 'b', f.agents, []);
  source.requestSequence = 2;
  const target = f.run;
  const token = Symbol();
  const chains = new Map([[f.project.id, token]]);
  const active = {
    run: source,
    request: { autoContinue: true },
    chain: token,
    sequence: 2,
    status: 'running',
    pid: process.pid,
  } as LiveRun;
  const live = new Map([[f.project.id + '/b', active]]);
  const journal = new TeamJournal(f.directory, f.project.id);
  // This older task has no active chain authorization.
  const older = await journal.accept(message(f.project.id, 'b', 'a', 'ordinary-queued'));
  let dispatched = 0;
  const host = runTeamAccess({
    live,
    chains,
    changing: new Set(),
    opening: new Set(),
    retiring: new Map(),
    assertUnchanged: () => {},
    open: async (request, _text, before, delivery, correction) => {
      assert.equal(request.autoContinue, false);
      assert.ok(correction?.isCurrent(f.project.id, 'a'));
      assert.equal(correction?.isCurrent(f.project.id, 'b'), false);
      live.set(f.project.id + '/a', { run: target } as LiveRun);
      await before(target);
      dispatched++;
      await journal.update(delivery.messageId, (item) => ({ ...item, state: 'completed' }));
      return { runId: target.record.runId, project: f.project };
    },
  });
  f.support.attach(host);
  // Editing the team constructor order does not change the project's saved pipeline.
  await f.store.saveSection('agentCatalog', {
    agents: f.agents,
    teams: [{ id: 'team', name: 'Team', agentIds: ['b', 'a'] }],
  });
  const args = { agent_id: 'a', text: 'Correct result', request_id: 'correction-1' };
  assert.throws(() => host.chainCorrection(source, 2, 'a', false), /текущий этап/);
  await assert.rejects(f.support.call({ ...source }, 'say_to', args), /текущий этап/);
  await assert.rejects(
    f.support.call(target, 'say_to', { ...args, agent_id: 'b' }),
    /текущий этап/,
  );
  const result = await f.support.groups(source)[0].call('say_to', args, AbortSignal.timeout(5000));
  assert.equal(JSON.parse(result.content[0].text!).state, 'completed');
  assert.equal(dispatched, 1);
  assert.equal(chains.get(f.project.id), token);
  assert.equal((await journal.get(older.id))?.state, 'queued');
  assert.equal(
    ((await f.support.call(source, 'say_to', args)) as { state: string }).state,
    'completed',
  );
  assert.equal(dispatched, 1);

  // A busy dialogue still holds the correction. Changing the source request invalidates it.
  Object.assign(live.get(f.project.id + '/a')!, { pid: process.pid, status: 'running' });
  const waiting = f.support
    .groups(source)[0]
    .call(
      'say_to_agent',
      { ...args, request_id: 'correction-expiring' },
      AbortSignal.timeout(5000),
    );
  const id = messageId(f.project.id, 'b', 'correction-expiring');
  for (let i = 0; i < 100 && !(await journal.get(id))?.reason; ++i)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await journal.get(id))?.state, 'queued');
  assert.match((await journal.get(id))?.reason ?? '', /выполняет запрос/);
  active.sequence++;
  source.requestSequence = active.sequence;
  const expired = await waiting;
  assert.equal(expired.isError, true);
  assert.equal(JSON.parse(expired.content[0].text!).state, 'failed');
  assert.equal(dispatched, 1);
});

test('team status, current permissions and project message polling never recursively scan outputs', async (t) => {
  const f = await fixture(t);
  f.store.projects.read = async () => {
    throw new Error('Team metadata polling must not scan files under the store lock');
  };
  const scope = await teamScope(f.service, f.run);
  assert.equal(scope.root, f.directory);
  assert.equal(scope.project.agents.length, 2);
  assert.ok(await f.support.call(f.run, 'list_agents', {}));
  assert.deepEqual(await f.support.projectMessages(f.project.id), []);
});

test('a recipient becoming busy before dispatch keeps the same task queued instead of failing or replaying', async (t) => {
  const f = await fixture(t);
  const journal = new TeamJournal(f.directory, f.project.id);
  let busy = false;
  const item = await journal.accept({
    version: 1,
    id: messageId(f.project.id, 'a', 'race-busy'),
    requestId: 'race-busy',
    projectId: f.project.id,
    sourceTeamId: 'team',
    senderId: 'a',
    recipientId: 'b',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: 'queued',
    text: 'ONE_TASK',
    bodyHash: messageHash('ONE_TASK'),
    lineage: ['a'],
  });
  await dispatchTeamMessage(
    f.service,
    {
      inspect: () => undefined,
      chainCorrection: () => undefined,
      teamUnavailable: () => (busy ? 'Получатель выполняет запрос.' : undefined),
      assertTeamDispatch: () => {},
      launchTeamTask: async () => {
        busy = true;
        throw Error('busy race');
      },
    },
    f.run,
    item,
    journal,
  );
  const queued = await journal.get(item.id);
  assert.equal(queued?.state, 'queued');
  assert.equal(queued?.text, 'ONE_TASK');
  assert.equal(queued?.runId, undefined);
});

test('an armed undelivered task ignores its obsolete manual-attention reason while waiting for delivery', async (t) => {
  const f = await fixture(t),
    journal = new TeamJournal(f.directory, f.project.id);
  const item = await journal.accept({
    version: 1,
    id: messageId(f.project.id, 'a', 'old-reason'),
    requestId: 'old-reason',
    projectId: f.project.id,
    sourceTeamId: 'team',
    senderId: 'a',
    recipientId: 'b',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: 'queued',
    text: 'NEW',
    bodyHash: messageHash('NEW'),
    lineage: ['a'],
    reason: 'Получатель ожидает пользователя после вопроса/ошибки. Продолжите его диалог вручную.',
  });
  let done = false;
  const wait = waitForTeamMessage(
    journal,
    new Set([item.id]),
    item.id,
    new AbortController().signal,
  ).then((result) => {
    done = true;
    return result;
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(done, false);
  await journal.update(item.id, (m) => ({ ...m, state: 'completed', reason: undefined }));
  assert.equal((await wait).state, 'completed');
});
