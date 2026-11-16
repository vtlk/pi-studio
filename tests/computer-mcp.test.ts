import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import { RunChannel, type SessionEnvelope } from '../src/main/pi/RunChannel.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import type { Agent } from '../src/shared/studio.ts';

const tool = {
  name: 'get_window_state',
  description: 'QA surface',
  inputSchema: { type: 'object', properties: {} },
};
const envelope: SessionEnvelope = {
  record: {} as never,
  instructions: '',
  resources: { skills: [], plugins: [], mcpServers: [] },
};

test(
  'revoking a lease or disconnecting its HTTP request aborts active system tool work',
  { timeout: 5000 },
  async (t) => {
    const channel = new RunChannel();
    t.after(() => channel.close());
    for (const revoke of [true, false]) {
      const entered = Promise.withResolvers<void>(),
        ended = Promise.withResolvers<void>();
      const lease = await channel.add(
        revoke ? 'revoked' : 'disconnected',
        envelope,
        async () => {},
        async () => ({}),
        [],
        [
          {
            name: 'pi_studio_computer',
            tools: [tool],
            async call(_name, _args, signal) {
              entered.resolve();
              await new Promise<void>((resolve) =>
                signal.addEventListener(
                  'abort',
                  () => {
                    ended.resolve();
                    resolve();
                  },
                  { once: true },
                ),
              );
              return { isError: true, content: [{ type: 'text', text: 'aborted' }] };
            },
          },
        ],
      );
      const controller = new AbortController();
      const request = fetch(lease.url + '/mcp/pi_studio_computer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${lease.token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: tool.name },
        }),
      }).catch(() => undefined);
      await entered.promise;
      if (revoke) channel.remove('revoked');
      else controller.abort();
      await ended.promise;
      await request;
    }
  },
);

test('system MCP leases isolate routes/tokens, preserve images and cancel only their own calls', async (t) => {
  const channel = new RunChannel();
  t.after(() => channel.close());
  const started = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const group = {
    name: 'pi_studio_computer',
    tools: [tool],
    async call(_name: string, args: Record<string, unknown>, signal: AbortSignal) {
      if (args.wait) {
        started.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelled.resolve();
              resolve();
            },
            { once: true },
          ),
        );
        return { isError: true, content: [{ type: 'text' as const, text: 'cancelled' }] };
      }
      return { content: [{ type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U=' }] };
    },
  };
  const a = await channel.add(
    'a',
    envelope,
    async () => {},
    async () => ({}),
    [],
    [group],
  );
  const b = await channel.add(
    'b',
    envelope,
    async () => {},
    async () => ({}),
    [],
    [group],
  );
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  const rpc = async (lease: typeof a, data: object, suffix = '/mcp/pi_studio_computer') => {
    const response = await fetch(lease.url + suffix, {
      method: 'POST',
      headers: headers(lease.token),
      body: JSON.stringify({ jsonrpc: '2.0', ...data }),
    });
    return response.status === 202 ? undefined : response.json();
  };
  assert.equal(
    (await fetch(a.url + '/mcp/pi_studio_computer', { headers: headers(b.token) })).status,
    403,
  );
  assert.equal(
    (await fetch(a.url + '/mcp/pi_studio_foreign', { headers: headers(a.token) })).status,
    403,
  );
  assert.equal(
    (await fetch(a.url + '/context/pi_studio_computer', { headers: headers(a.token) })).status,
    403,
  );
  const context = await (await fetch(a.url + '/context', { headers: headers(a.token) })).json();
  assert.equal(context.resources.mcpServers[0].config.url, a.url + '/mcp/pi_studio_computer');
  assert.equal(
    envelope.resources.mcpServers.length,
    0,
    'Never persist capability URLs in the original resource record.',
  );
  assert.equal((await rpc(a, { id: 1, method: 'tools/list' }, '/mcp')).result.tools.length, 0);
  assert.equal((await rpc(a, { id: 2, method: 'tools/list' })).result.tools[0].name, tool.name);
  assert.deepEqual(
    (await rpc(a, { id: 3, method: 'tools/call', params: { name: tool.name } })).result.content,
    [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
  );
  assert.equal(
    (await rpc(a, { id: 4, method: 'tools/call', params: { name: tool.name, arguments: [] } }))
      .error.code,
    -32600,
  );
  const pending = rpc(a, {
    id: 5,
    method: 'tools/call',
    params: { name: tool.name, arguments: { wait: true } },
  });
  await started.promise;
  await rpc(b, { method: 'notifications/cancelled', params: { requestId: 5 } });
  assert.equal(
    (await rpc(a, { id: 5, method: 'tools/call', params: { name: tool.name } })).result.isError,
    true,
    'Other lease cannot cancel the active request.',
  );
  await rpc(a, { method: 'notifications/cancelled', params: { requestId: 5 } });
  await cancelled.promise;
  assert.equal((await pending).result.isError, true);
  assert.equal(
    (await rpc(a, { id: 5, method: 'tools/call', params: { name: tool.name } })).result.isError,
    undefined,
    'A settled request ID can be reused.',
  );
  channel.remove('a');
  assert.equal((await fetch(a.url + '/context', { headers: headers(a.token) })).status, 403);
  assert.equal((await rpc(b, { id: 6, method: 'ping' })).result.constructor, Object);
});

test('Computer Use binds private sessions without permissions or image support blocking text work', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-computer-mcp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  const agent: Agent = {
    id: 'qa',
    name: 'QA',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: ['pistudio-project', 'pistudio-computer'],
    plugins: [],
    model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'off', temperature: '' },
  };
  const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
    .projects[0];
  const projectRoot = await store.projects.directory(project.id);
  const runs = await Promise.all(
    [1, 2, 3].map(() => buildRunContext(projectRoot, project, agent.id, [agent], [])),
  );
  const sessions: string[] = [],
    released: string[] = [];
  let closes = 0;
  const support = new ComputerSupport({
    tools: async () => [tool],
    permissions: async () => ({ accessibility: false, screenRecording: false }),
    call: async (session) => {
      sessions.push(session);
      return { content: [{ type: 'text', text: 'QA' }] };
    },
    release: async (session) => {
      released.push(session);
    },
    close: async () => {
      closes++;
    },
  });
  t.after(() => support.drain());
  await support.bind(runs[0], true);
  await support.bind(runs[1], true);
  await support.bind(runs[2], false);
  const signal = new AbortController().signal;
  await support.groups(runs[0])[0].call(tool.name, {}, signal);
  await support.groups(runs[1])[0].call(tool.name, {}, signal);
  assert.equal(new Set(sessions).size, 2);
  assert.deepEqual(
    support.groups(runs[2])[0].tools.map((item) => item.name),
    ['check_permissions'],
  );
  const status = await support.groups(runs[2])[0].call('check_permissions', {}, signal);
  assert.match(JSON.stringify(status), /permissions_required/);
  assert.equal(status.isError, undefined);
  assert.equal((await support.groups(runs[2])[0].call(tool.name, {}, signal)).isError, true);
  const context = await readFile(
    join(projectRoot, '.pistudio/context', runs[0].record.runId, 'context.json'),
    'utf8',
  );
  assert.match(context, /pistudio-computer/);
  assert.equal(context.includes(sessions[0]), false);
  support.release(runs[0]);
  assert.equal(support.groups(runs[0]).length, 0);
  await support.drain();
  assert.equal(released.length, 3);
  assert.equal(closes, 1);
  await assert.rejects(support.bind(runs[0], true), /закрывается/);
});
