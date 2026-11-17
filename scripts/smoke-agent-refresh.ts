import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { AgentRefresh } from '../src/main/storage/AgentRefresh.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { AgentRefreshReview } from '../src/shared/agentRefresh.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-refresh-sdk-'));
await mkdir(join(root, 'Native'));
process.env.PI_CODING_AGENT_DIR = join(root, 'Native');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const waiting = new Map<string, ServerResponse>();
let requests = 0,
  failure: unknown;
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const data of req) chunks.push(Buffer.from(data));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (req.url === '/mcp') {
      if (!('id' in body)) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result:
            body.method === 'initialize'
              ? {
                  protocolVersion: body.params.protocolVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: 'Owned refresh MCP', version: '1' },
                }
              : body.method === 'tools/list'
                ? {
                    tools: [
                      {
                        name: 'refresh_probe',
                        description: 'Owned fixture',
                        inputSchema: { type: 'object', properties: {} },
                      },
                    ],
                  }
                : {},
        }),
      );
      return;
    }
    requests++;
    assert.equal(body.model, 'qa-refresh');
    const text = JSON.stringify(
      body.messages.filter((message: { role: string }) => message.role === 'user').at(-1).content,
    );
    const marker = text.match(/QA_[A-Z0-9_]+/)?.[0] ?? '';
    if (marker === 'QA_MCP_CHECK')
      assert.ok(
        body.tools.some((tool: { function: { name: string } }) =>
          tool.function.name.endsWith('refresh_probe'),
        ),
        'New MCP is in the actual model tool set',
      );
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({
      id: 'refresh',
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Reply ' + marker }))}\n\n`,
    );
    if (marker.includes('BUSY')) {
      waiting.set(marker, res);
      res.once('close', () => waiting.delete(marker));
    } else res.end(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    failure = error;
    res.statusCode = 500;
    res.end('Fixture failed');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const connection = {
  id: 'qa-refresh',
  name: 'Refresh fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-refresh'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-refresh',
        name: 'QA refresh',
        imageInput: false,
        reasoning: false,
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const agents: Agent[] = ['a', 'b', 'dormant'].map((id) => ({
  id,
  name: 'Refresh ' + id,
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-refresh',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agents', agents);
const team = store.agentCatalog().teams[0];
const project = (
  await store.command({
    kind: 'create',
    name: 'Refresh fixture',
    agents: store.teamProfiles(team.id),
    teamId: team.id,
  })
).projects[0];
const other = (
  await store.command({
    kind: 'create',
    name: 'Other project',
    agents: store.teamProfiles(team.id),
    teamId: team.id,
  })
).projects.find((item) => item.id !== project.id)!;
const host = createStudioRunHost(service, {
  embedded: true,
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
});
const refresh = new AgentRefresh(service, host);
const target = (agentId = 'a', projectId = project.id) => ({ projectId, agentId });
const pid = (agentId = 'a', projectId = project.id) =>
  host.processes().find((run) => run.agentId === agentId && run.projectId === projectId)?.pid;
const until = async (check: () => unknown) => {
  for (let i = 0; i < 500; i++) {
    if (failure) throw failure;
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(check(), 'Refresh fixture condition timed out');
};
const apply = (review: AgentRefreshReview, approve = false, updateExisting = true) =>
  refresh.apply({
    kind: 'update-agents',
    projectId: project.id,
    agents: store.teamProfiles(team.id),
    updateExisting,
    refresh: {
      revision: review.revision,
      running: approve
        ? [...review.restarting, ...review.removing]
            .filter((run) => run.working)
            .map(({ runId, sequence }) => ({ runId, sequence }))
        : [],
    },
  });
const edit = async (id: string, update: (agent: Agent) => Agent) =>
  service.serialize(() =>
    store.saveSection(
      'agents',
      (store.bootstrap().sections.agents as Agent[]).map((agent) =>
        agent.id === id ? update(agent) : agent,
      ),
    ),
  );
try {
  await host.launch({ ...target(), autoContinue: false });
  await host.sendChat({ ...target(), text: 'QA_INIT: Reply once.' });
  await until(() => !host.chat(target())?.working);
  await host.launch({ ...target('b'), autoContinue: false });
  await host.sendChat({ ...target('b'), text: 'QA_B_BUSY: Keep working.' });
  await until(() => waiting.has('QA_B_BUSY'));
  await host.launch({ ...target('a', other.id), autoContinue: false });
  const originalA = pid(),
    originalB = pid('b'),
    otherPid = pid('a', other.id);
  const unchanged = await refresh.prepare(project.id, true);
  assert.deepEqual(
    unchanged.changed,
    [],
    'Unchanged running configurations are not considered changed',
  );
  const saved = (await store.projects.read(project.id)).agents.find(
    (agent) => agent.profile.id === 'a',
  )!.session!;
  const history = join(await store.projects.directory(project.id), saved.path),
    before = await readFile(history);
  const mcp: Resource = {
    id: 'refresh-mcp',
    name: 'Refresh MCP',
    kind: 'mcps',
    source: `http://127.0.0.1:${port}/mcp`,
    version: '',
    description: 'Owned fixture',
    transport: 'HTTP',
    args: '',
    credential: '',
    contents: '',
    createdAt: 1,
  };
  await store.saveSection('resources', [mcp]);
  await edit('a', (agent) => ({ ...agent, mcps: [...agent.mcps, mcp.id] }));
  const review = await refresh.prepare(project.id, true);
  assert.deepEqual(
    review.changed.map((agent) => agent.id),
    ['a'],
  );
  assert.deepEqual(
    review.restarting.map((run) => [run.agentId, run.working]),
    [['a', false]],
  );
  await apply(review);
  assert.notEqual(pid(), originalA);
  assert.equal(pid('b'), originalB);
  assert.equal(pid('a', other.id), otherPid);
  assert.equal(host.chat(target('b'))?.working, true, 'Unrelated work continues');
  assert.deepEqual(
    await readFile(history),
    before,
    'Idle restart does not rewrite/replay the exact dialogue',
  );
  const restored = (await store.projects.read(project.id)).agents.find(
    (agent) => agent.profile.id === 'a',
  )!.session!;
  assert.equal(restored.id, saved.id);
  assert.equal(restored.path, saved.path);
  assert.equal(requests, 2, 'Restart sends no prompt');
  await host.sendChat({ ...target(), text: 'QA_MCP_CHECK: Check tools.' });
  await until(() => !host.chat(target())?.working);
  await host.sendChat({ ...target(), text: 'QA_A_BUSY1: Keep working.' });
  await until(() => waiting.has('QA_A_BUSY1'));
  await edit('a', (agent) => ({ ...agent, mainInstruction: 'Updated current role' }));
  const busy = await refresh.prepare(project.id, true),
    busyPid = pid();
  assert.equal(
    busy.restarting[0].working,
    true,
    'Prompt-only edits also identify the changed running agent',
  );
  await assert.rejects(apply(busy), /confirm|подтверд/);
  assert.equal(pid(), busyPid);
  assert.equal(host.chat(target())?.working, true);
  await host.abortChat(target());
  await host.sendChat({ ...target(), text: 'QA_A_BUSY2: New task.' });
  await until(() => waiting.has('QA_A_BUSY2'));
  await assert.rejects(apply(busy, true), /confirm|подтверд/);
  assert.equal(pid(), busyPid, 'Old task consent cannot stop a new task');
  const fresh = await refresh.prepare(project.id, true),
    prefix = await readFile(history),
    requestCount = requests;
  await apply(fresh, true);
  assert.notEqual(pid(), busyPid);
  assert.equal(pid('b'), originalB);
  assert.equal(pid('a', other.id), otherPid);
  assert.equal(host.chat(target())?.working, false);
  assert.equal(requests, requestCount, 'Interrupted task is not resent');
  assert.deepEqual((await readFile(history)).subarray(0, prefix.length), prefix);
  const noChange = await refresh.prepare(project.id, true);
  assert.deepEqual(noChange.changed, []);
  const same = pid();
  await apply(noChange);
  assert.equal(pid(), same, 'No-change refresh preserves every process');
  await edit('b', (agent) => ({ ...agent, mcps: [...agent.mcps, mcp.id] }));
  const doNotUpdate = await refresh.prepare(project.id, false);
  assert.equal(doNotUpdate.restarting.length, 0);
  await apply(doNotUpdate, false, false);
  assert.equal(pid('b'), originalB, 'Unchecked profile update never restarts a changed profile');
  await host.stopAgent(project.id, 'a');
  await edit('a', (agent) => ({ ...agent, name: 'Changed closed agent' }));
  const closed = await refresh.prepare(project.id, true);
  // b is still busy and must not be stopped without consent; close the affected request explicitly for this check.
  await host.abortChat(target('b'));
  const idle = await refresh.prepare(project.id, true);
  await apply(idle);
  assert.equal(pid(), undefined, 'A closed changed agent is not launched');
  assert.equal(pid('dormant'), undefined, 'A never-opened agent is not launched');
  assert.equal(host.chat(target('a', other.id))?.phase, 'ready');
  assert.ok(closed.changed.some((agent) => agent.id === 'a'));
  console.log(
    JSON.stringify(
      {
        ok: true,
        pi: pi.version,
        scope:
          'real isolated Pi SDK, actual refresh service and synthetic local model/MCP; no external LLM, desktop permissions or user studio',
        checks: [
          'only changed live agent restarts',
          'unrelated working agent and other project retain PID',
          'exact session ID/path/history preserved',
          'new MCP reaches model tool set',
          'working task needs exact consent',
          'stale task consent rejected',
          'no task replay',
          'no-change refresh',
          'unchecked updates',
          'closed/never-opened agents stay closed',
          'prompt-only changes detected',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const res of waiting.values()) res.destroy();
  await host.drain();
  host.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
