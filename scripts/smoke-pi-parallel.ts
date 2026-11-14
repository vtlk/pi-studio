import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { ProjectActivity } from '../src/main/pi/ProjectActivity.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-parallel-sdk-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const waiting = new Map<string, ServerResponse>();
let requests = 0;
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, undefined);
  assert.equal(body.model, 'qa-parallel');
  const user = JSON.stringify(
    body.messages.filter((m: { role: string }) => m.role === 'user').at(-1).content,
  );
  const id = user.includes('PARALLEL_A') ? 'a' : user.includes('PARALLEL_B') ? 'b' : '';
  assert.ok(id);
  assert.equal(waiting.has(id), false, 'No duplicate/retried model request');
  requests++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    `data: ${JSON.stringify({ id: 'qa-' + id, object: 'chat.completion.chunk', created: 1, model: 'qa-parallel', choices: [{ index: 0, delta: { role: 'assistant', content: 'Working ' }, finish_reason: null }] })}\n\n`,
  );
  waiting.set(id, res);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const connection = {
  id: 'qa-parallel',
  name: 'Local concurrency fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-parallel'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-parallel',
        name: 'QA parallel',
        imageInput: false,
        reasoning: false,
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const agents: Agent[] = ['a', 'b'].map((id) => ({
  id,
  name: 'Parallel ' + id,
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-parallel',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agents', agents);
const project = (await store.command({ kind: 'create', name: 'Parallel SDK QA', agents }))
  .projects[0];
const children: Promise<number | null>[] = [];
const activity = new ProjectActivity();
const host = createStudioRunHost(service, {
  activity,
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
const until = async (check: () => boolean) => {
  const end = Date.now() + 12000;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), 'Timed out waiting for simultaneous native Pi requests');
};
const release = (id: string) => {
  const res = waiting.get(id)!;
  res.write(
    `data: ${JSON.stringify({ id: 'qa-' + id, object: 'chat.completion.chunk', created: 1, model: 'qa-parallel', choices: [{ index: 0, delta: { content: 'result ' + id }, finish_reason: null }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ id: 'qa-' + id, object: 'chat.completion.chunk', created: 1, model: 'qa-parallel', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
  );
  res.end();
};
try {
  const first = await host.launch({
    projectId: project.id,
    agentId: 'a',
    autoContinue: false,
    firstMessage: 'PARALLEL_A: Reply once without tools.',
  });
  await until(() => waiting.has('a'));
  assert.deepEqual(activity.list(), [{ projectId: project.id, runningAgents: 1 }]);
  const second = await host.launch({
    projectId: project.id,
    agentId: 'b',
    autoContinue: false,
    firstMessage: 'PARALLEL_B: Reply once without tools.',
  });
  await until(() => waiting.has('b'));
  assert.deepEqual(activity.list(), [{ projectId: project.id, runningAgents: 2 }]);
  let current = await store.projects.read(project.id);
  assert.deepEqual(
    current.agents.map((a) => a.runStatus),
    ['running', 'running'],
  );
  assert.throws(() => host.assertIdle(project.id), /Дождитесь/);
  assert.equal(children.length, 2);
  assert.equal(requests, 2);
  const paths = current.agents.map((a) => a.session!.path);
  assert.notEqual(paths[0], paths[1]);
  const directory = await store.projects.directory(project.id);
  for (const agent of current.agents)
    await writeFile(join(directory, agent.outputPath, 'marker.txt'), agent.profile.id);
  release('a');
  assert.equal(await children[0], 0);
  assert.deepEqual(activity.list(), [{ projectId: project.id, runningAgents: 1 }]);
  current = await store.projects.read(project.id);
  assert.equal(current.agents[1].runStatus, 'running');
  assert.throws(() => host.assertIdle(project.id), /Дождитесь/);
  release('b');
  assert.equal(await children[1], 0);
  assert.deepEqual(activity.list(), []);
  host.assertIdle(project.id);
  const messages = async (path: string) =>
    (await readFile(join(directory, path), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'message');
  const before = await Promise.all(paths.map(messages));
  assert.ok(JSON.stringify(before[0]).includes('PARALLEL_A'));
  assert.equal(JSON.stringify(before[0]).includes('PARALLEL_B'), false);
  assert.ok(JSON.stringify(before[1]).includes('PARALLEL_B'));
  assert.equal(JSON.stringify(before[1]).includes('PARALLEL_A'), false);
  await Promise.all(
    agents.map((a) => host.launch({ projectId: project.id, agentId: a.id, autoContinue: false })),
  );
  assert.deepEqual(await Promise.all(children.slice(2)), [0, 0]);
  current = await store.projects.read(project.id);
  assert.deepEqual(
    current.agents.map((a) => a.session!.path),
    paths,
  );
  assert.deepEqual(await Promise.all(paths.map(messages)), before);
  assert.equal(requests, 2, 'Idle resumes send no request or replay');
  assert.deepEqual(activity.list(), []);
  for (const agent of current.agents)
    assert.equal(
      await readFile(join(directory, agent.outputPath, 'marker.txt'), 'utf8'),
      agent.profile.id,
    );
  const proof = {
    passed: true,
    pi: pi.version,
    scope:
      'Two real native Pi processes, production Studio RunHost/bridge, one project; synthetic SSE model on loopback only',
    simultaneousRequests: true,
    secondOpenedWhileFirstStreaming: true,
    independentBindingsAndMessages: true,
    independentOutputs: true,
    oneCompletionDoesNotStopOther: true,
    mutationsWaitForBoth: true,
    exactIdleResumesNoReplay: true,
    localModelRequests: requests,
    externalModelRequests: 0,
    runIdsDistinct: first.runId !== second.runId,
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/project-activity-runtime-proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        nativePi: pi.version,
        actualProductionHost: true,
        localModelRequests: requests,
        externalModelRequests: 0,
        confirmedRuntimeStart: true,
        parallelCounts: [1, 2, 1, 0],
        stopOnlyAfterLastAgent: true,
        idleResumeDoesNotStartActivity: true,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    resolve('artifacts/parallel-agents-proof.json'),
    JSON.stringify(
      {
        ...JSON.parse(
          await readFile(resolve('artifacts/parallel-agents-proof.json'), 'utf8').catch(() => '{}'),
        ),
        latestNativeControl: {
          checkedAt: new Date().toISOString(),
          result: proof,
          projectActivity: true,
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  for (const res of waiting.values()) if (!res.writableEnded) res.end();
  host.close();
  await Promise.allSettled(children);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
