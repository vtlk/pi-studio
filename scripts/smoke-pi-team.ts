import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { TeamSupport } from '../src/main/team-mcp/TeamSupport.ts';
import { messageId } from '../src/main/team-mcp/TeamJournal.ts';
import { teamMcpId } from '../src/shared/builtinResources.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';

// Real installed Pi SDK/bridge/MCP/files/sessions; deterministic loopback model, zero external requests.
const root = await mkdtemp(join(tmpdir(), 'pistudio-team-native-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, 'Agent');
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
let senderStep = 0,
  workerStep = 0,
  workerFinished = 0,
  failure: unknown;
let projectId = '',
  directory = '';
const envelopes: { firstMessage?: string; resources: { mcpServers: { name: string }[] } }[] = [];
const children: { child: ReturnType<typeof spawn>; done: Promise<number | null> }[] = [];
let profiles: Agent[];
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(
      JSON.stringify(body.tools).includes('library_'),
      false,
      'Removed tools never reach the real Pi model request',
    );
    const lastUser = JSON.stringify(
      body.messages.filter((item: { role: string }) => item.role === 'user').at(-1).content,
    );
    const worker = !lastUser.includes('TEAM_SENDER_ROOT');
    const content = JSON.stringify(body.messages);
    let toolName = '',
      args: object = {};
    if (worker) {
      const step = workerStep++;
      assert.ok(content.includes(directory));
      if (step === 0) {
        toolName = 'say_to_agent';
        args = { agent_id: 'sender', text: 'Cycle must fail', request_id: 'cycle' };
      }
      if (step === 1) {
        assert.ok(/Самопосылка|цикл/.test(content));
        toolName = 'write';
        args = { path: 'output/result.txt', content: 'TEAM_FIRST_OK' };
      }
      if (step === 2) {
        toolName = 'complete_stage';
        args = { outputs: ['result.txt'] };
      }
      if (step === 3) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        workerFinished = 1;
      }
      if (step === 4) {
        assert.ok(
          content.includes('UPDATED_CURRENT_WORKER_ROLE'),
          'Exact resume reads current constructor instructions',
        );
        assert.ok(lastUser.includes('TASK_TWO'));
        toolName = 'write';
        args = { path: 'output/result-two.txt', content: 'TEAM_SECOND_OK' };
      }
      if (step === 5) {
        toolName = 'complete_stage';
        args = { outputs: ['result-two.txt'] };
      }
      if (step === 6) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        workerFinished = 2;
      }
      assert.ok(step <= 6, 'No duplicate recipient model requests');
    } else {
      const step = senderStep++;
      if (step === 0) toolName = 'list_agents';
      if (step === 1) {
        assert.ok(content.includes('sourceTeamId'));
        toolName = 'read_agent_settings';
        args = { agent_id: 'worker' };
      }
      if (step === 2) {
        assert.ok(content.includes('FULL_CURRENT_BLOCK_TEXT'));
        assert.ok(content.includes('appliedRuntime'));
        assert.equal(content.includes('PRIVATE_ACCOUNT_SENTINEL'), false);
        toolName = 'list_output';
        args = { agent_id: 'worker' };
      }
      if (step === 3) {
        assert.ok(content.includes('seed.bin'));
        toolName = 'read_output';
        args = { agent_id: 'worker', path: 'seed.bin', max_bytes: 8 };
      }
      if (step === 4) {
        assert.ok(content.includes('base64'));
        toolName = 'say_to_agent';
        args = {
          agent_name: 'Worker',
          text: 'TASK_ONE: write result then complete_stage',
          request_id: 'task-one',
        };
      }
      if (step === 5) {
        assert.equal(
          workerFinished,
          1,
          'Sender must not get another model turn until worker has settled',
        );
        assert.ok(content.includes('completed'));
        toolName = 'message_status';
        args = { message_id: messageId(projectId, 'sender', 'task-one') };
      }
      if (step === 6) {
        toolName = 'read_output';
        args = { agent_id: 'worker', path: 'result.txt' };
      }
      if (step === 7) {
        assert.ok(content.includes('TEAM_FIRST_OK'));
        profiles = profiles.map((profile) =>
          profile.id === 'worker'
            ? { ...profile, mainInstruction: 'UPDATED_CURRENT_WORKER_ROLE' }
            : profile,
        );
        await service.serialize(() => store.saveSection('agents', profiles));
        toolName = 'say_to_agent';
        args = {
          agent_id: 'worker',
          text: 'TASK_TWO: write second result then complete_stage',
          request_id: 'task-two',
        };
      }
      if (step === 8) {
        assert.equal(workerFinished, 2);
        toolName = 'say_to_agent';
        args = {
          agent_id: 'worker',
          text: 'TASK_TWO: write second result then complete_stage',
          request_id: 'task-two',
        };
      }
      if (step === 9) {
        assert.equal(workerStep, 7, 'Same request_id never replays the task');
        toolName = 'read_output';
        args = { agent_id: 'worker', path: 'result-two.txt' };
      }
      if (step === 10) {
        assert.ok(content.includes('TEAM_SECOND_OK'));
        toolName = 'write';
        args = { path: 'output/sender.txt', content: 'WAITED_FOR_TEAM_OK' };
      }
      if (step === 11) {
        toolName = 'complete_stage';
        args = { outputs: ['sender.txt'] };
      }
      assert.ok(step <= 12, 'No duplicate sender model requests');
    }
    const tool = body.tools?.find((entry: { function: { name: string } }) =>
      toolName === 'write'
        ? entry.function.name === toolName
        : entry.function.name.endsWith('__' + toolName),
    );
    if (toolName) assert.ok(tool, 'Native MCP/native tool exposed: ' + toolName);
    const delta = toolName
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `team-${worker ? 'w' : 's'}-${worker ? workerStep : senderStep}`,
              type: 'function',
              function: { name: tool.function.name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: 'assistant', content: 'Done.' };
    const item = (delta: object, finish_reason: string | null) => ({
      id: 'qa-team',
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
    res.write(`data: ${JSON.stringify(item({}, toolName ? 'tool_calls' : 'stop'))}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) {
    failure = error;
    res.writeHead(500);
    res.end('QA assertion failed');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const connection = {
  id: 'qa-team',
  name: 'Team local fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-team'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: 'PRIVATE_ACCOUNT_SENTINEL',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-team',
        name: 'QA team',
        imageInput: false,
        reasoning: false,
        contextWindow: 32768,
        maxTokens: 2048,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
profiles = ['sender', 'worker'].map((id) => ({
  id,
  name: id === 'worker' ? 'Worker' : 'Sender',
  enabled: true,
  instructions: [
    { id: 'block-' + id, name: 'Current', enabled: true, content: 'FULL_CURRENT_BLOCK_TEXT' },
  ],
  mainInstruction: 'Execute native team QA',
  skills: [],
  mcps: [teamMcpId],
  plugins: [],
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-team',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agentCatalog', {
  agents: profiles,
  teams: [{ id: 'team', name: 'Native QA', agentIds: profiles.map((item) => item.id) }],
});
const project = (
  await store.command({ kind: 'create', name: 'Native MCP team', agents: profiles, teamId: 'team' })
).projects[0];
projectId = project.id;
directory = await store.projects.directory(projectId);
await writeFile(
  join(directory, project.agents[1].outputPath, 'seed.bin'),
  Buffer.from([0, 1, 2, 255, 0, 99, 4, 5]),
);
const team = new TeamSupport(service);
const host = createStudioRunHost(service, {
  team,
  bootstraps: join(root, 'boots'),
  bridge:
    process.env.PI_STUDIO_QA_BRIDGE ||
    new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const transport = JSON.parse(await readFile(bootstrap, 'utf8'));
    const envelope = await (
      await fetch(transport.url + '/context', {
        headers: { Authorization: `Bearer ${transport.token}` },
      })
    ).json();
    envelopes.push(envelope);
    const child = spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    let log = '';
    child.stdout?.on('data', (chunk) => {
      log += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      log += chunk;
    });
    children.push({
      child,
      done: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code && !failure)
            failure = new Error('Owned Pi QA process failed: ' + log.slice(-1000));
          resolve(code);
        });
      }),
    });
  },
});
try {
  await host.launch({
    projectId,
    agentId: 'sender',
    firstMessage: 'TEAM_SENDER_ROOT',
    autoContinue: false,
  });
  const deadline = Date.now() + 90000;
  while (
    Date.now() < deadline &&
    !failure &&
    (await store.projects.read(projectId)).agents[0].runStatus !== 'ready'
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (failure) throw failure;
  const result = await store.projects.read(projectId);
  assert.equal(result.agents[0].runStatus, 'ready', 'Native wait/delivery workflow completed');
  assert.equal(senderStep, 13);
  assert.equal(workerStep, 7);
  assert.equal(children.length, 3, 'Only sender and two exact worker opens');
  const session = result.agents[1].session!;
  const transcript = await readFile(join(directory, session.path), 'utf8');
  const users = transcript
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'message' && entry.message.role === 'user');
  assert.equal(users.length, 2, 'One canonical binding, exactly two delivered tasks');
  assert.ok(JSON.stringify(users[0]).includes('TASK_ONE'));
  assert.ok(JSON.stringify(users[1]).includes('TASK_TWO'));
  assert.equal(
    await readFile(join(directory, result.agents[0].outputPath, 'sender.txt'), 'utf8'),
    'WAITED_FOR_TEAM_OK',
  );
  await Promise.all(children.map((item) => item.done));
  profiles = profiles.map((profile) =>
    profile.id === 'worker' ? { ...profile, mcps: [] } : profile,
  );
  await service.serialize(() => store.saveSection('agents', profiles));
  await host.launch({ projectId, agentId: 'worker', autoContinue: false });
  await children.at(-1)!.done;
  assert.equal(envelopes.at(-1)!.firstMessage, undefined, 'Ordinary resume sends nothing');
  assert.equal(
    envelopes.at(-1)!.resources.mcpServers.some((item) => item.name === 'team'),
    false,
    'Revocation removes actual transport',
  );
  assert.equal((await store.projects.read(projectId)).agents[1].session!.path, session.path);
  assert.equal(workerStep, 7, 'Ordinary resume did not request model');
  const proof = {
    nativePi: pi.version,
    packagedBridge: !!process.env.PI_STUDIO_QA_BRIDGE,
    loopbackModel: true,
    externalModelRequests: 0,
    userStudioTouched: false,
    sourceTeamScoped: true,
    allToolsThroughNativeMcp: true,
    blockingWait: true,
    recipientTasks: 2,
    exactExistingBinding: true,
    duplicateReplay: false,
    cycleRejected: true,
    revokedOnExplicitOpen: true,
    ordinaryResumeUserMessages: 0,
    windowsRuntimeAccepted: false,
    visibleTerminalAccepted: false,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/team-mcp-native-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  team.close();
  await host.drain();
  host.close();
  for (const { child } of children)
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  await Promise.allSettled(children.map((item) => item.done));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
}
