import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { TeamWorkspaceMode } from '../src/shared/agentTeams.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { RunContextRecord } from '../src/shared/runtime.ts';
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';

const root = await mkdtemp(join(tmpdir(), 'pistudio-live-team-workspace-'));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, 'Pi');
await mkdir(process.env.PI_CODING_AGENT_DIR);
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
let failure: unknown;
const steps = new Map<string, number>();
let modelCalls = 0;
let separateDirectory: string;
function checkWorkspacePrompt(
  prompt: string,
  root: string,
  agent: string,
  mode: TeamWorkspaceMode,
) {
  const shared = mode === 'shared';
  const cwd = shared ? root : join(root, 'agents', agent);
  const output = shared ? root : join(cwd, 'output');
  const previousOutputs =
    agent === 'one'
      ? []
      : [
          {
            agentId: 'one',
            agentName: 'one',
            path: shared ? root : join(root, 'agents/one/output'),
          },
        ];
  for (const line of [
    `Project directory (absolute): ${JSON.stringify(root)}`,
    `Working directory (${shared ? 'shared team' : 'agent'}): ${JSON.stringify(cwd)}`,
    `Write all deliverables under: ${JSON.stringify(output)}`,
    `Earlier agents' outputs: ${JSON.stringify(previousOutputs)}`,
  ])
    assert.ok(prompt.split('\n').includes(line), line);
}
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const text = JSON.stringify(body.messages);
    const separate = text.includes('TASK_SEPARATE_TWO');
    const id = text.includes('TASK_ONE') ? 'one' : 'two';
    const key = separate ? 'separate' : id;
    const step = steps.get(key) ?? 0;
    steps.set(key, step + 1);
    modelCalls++;
    const prompt = body.messages.find(
      (message: { role: string }) => message.role === 'system',
    ).content;
    checkWorkspacePrompt(
      prompt,
      separate ? separateDirectory : directory,
      id,
      separate ? 'per-agent' : 'shared',
    );
    if (separate) assert.match(prompt, /Prefer cwd-relative output\//);
    else assert.match(prompt, /directly in the project root/);
    const name = step === 0 ? 'write' : step === 1 ? 'complete_stage' : '';
    const tool = body.tools?.find((tool: { function: { name: string } }) =>
      name === 'write' ? tool.function.name === name : tool.function.name.endsWith('__' + name),
    );
    if (name) assert.ok(tool);
    const delta = name
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `qa-${id}-${step}`,
              type: 'function',
              function: {
                name: tool.function.name,
                arguments: JSON.stringify(
                  step === 0
                    ? { path: `${separate ? 'output/' : ''}${id}.txt`, content: `RESULT_${id}` }
                    : { outputs: [`${id}.txt`] },
                ),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Done.' };
    const item = (delta: object, finish_reason: string | null) => ({
      id: 'qa',
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
    res.write(`data: ${JSON.stringify(item({}, name ? 'tool_calls' : 'stop'))}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) {
    failure = error;
    res.writeHead(500);
    res.end('QA assertion failed');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const connection = {
  id: 'local',
  name: 'Local QA',
  purpose: 'local',
  providerId: endpointProviderId('local'),
  authScope: 'connection',
  endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions',
    auth: 'none',
    models: [
      {
        id: 'qa',
        name: 'QA',
        imageInput: false,
        reasoning: false,
        contextWindow: 32768,
        maxTokens: 2048,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const profiles: Agent[] = ['one', 'two'].map((id) => ({
  id,
  name: id,
  enabled: true,
  instructions: [],
  mainInstruction: 'Execute the current task.',
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: 'local',
    provider: connection.providerId,
    id: 'qa',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
const team = {
  id: 'team',
  name: 'Shared',
  agentIds: ['one', 'two'],
  workspaceMode: 'shared' as const,
};
await store.saveSection('agentCatalog', { agents: profiles, teams: [team] });
const project = (
  await store.command({ kind: 'create', name: 'Shared project', teamId: 'team', agents: profiles })
).projects[0];
const directory = await store.projects.directory(project.id);
const envelopes: (Parameters<typeof sessionSystemPrompt>[0] & {
  record: RunContextRecord;
  firstMessage?: string;
})[] = [];
const children: { process: ReturnType<typeof spawn>; done: Promise<number | null> }[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: fileURLToPath(new URL('../bundled/pi-bridge/session.mjs', import.meta.url)),
  catalog: fileURLToPath(new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url)),
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const transport = JSON.parse(await readFile(bootstrap, 'utf8'));
    envelopes.push(
      await (
        await fetch(transport.url + '/context', {
          headers: { Authorization: `Bearer ${transport.token}` },
        })
      ).json(),
    );
    const process = spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...globalThis.process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    let log = '';
    process.stdout?.on('data', (chunk) => (log += chunk));
    process.stderr?.on('data', (chunk) => (log += chunk));
    children.push({
      process,
      done: new Promise((resolve, reject) => {
        process.once('error', reject);
        process.once('exit', (code) => {
          if (code && !failure) failure = new Error(log.slice(-2000));
          resolve(code);
        });
      }),
    });
  },
});
const timer = setTimeout(() => {
  host.close();
  for (const child of children) if (child.process.exitCode === null) child.process.kill('SIGTERM');
}, 120000);
try {
  await Promise.all(
    profiles.map((agent) =>
      host.launch({
        projectId: project.id,
        agentId: agent.id,
        autoContinue: false,
        firstMessage: agent.id === 'one' ? 'TASK_ONE' : 'TASK_TWO',
      }),
    ),
  );
  assert.deepEqual(await Promise.all(children.map((child) => child.done)), [0, 0]);
  if (failure) throw failure;
  let current = await store.projects.read(project.id);
  const histories = new Map<string, string>();
  for (const agent of current.agents) {
    assert.equal(agent.runStatus, 'ready');
    assert.equal(
      await readFile(join(directory, `${agent.profile.id}.txt`), 'utf8'),
      `RESULT_${agent.profile.id}`,
    );
    assert.ok(agent.session?.path.startsWith(`.pistudio/sessions/${agent.profile.id}/`));
    histories.set(agent.profile.id, await readFile(join(directory, agent.session!.path), 'utf8'));
  }
  assert.deepEqual((await readdir(directory)).sort(), [
    '.pistudio',
    'one.txt',
    'project.json',
    'two.txt',
  ]);
  assert.equal(envelopes[0].record.cwd, directory);
  assert.equal(envelopes[0].record.output, directory);
  assert.equal(envelopes[1].record.cwd, directory);
  assert.notEqual(envelopes[0].record.leaseDirectory, envelopes[1].record.leaseDirectory);
  // Emulate an existing release's legacy session location, keeping its exact transcript.
  const savedSession = current.agents[0].session!;
  const legacySessionDirectory = join(directory, 'agents/one/sessions');
  await mkdir(join(directory, 'agents/one'), { recursive: true });
  await rename(join(directory, '.pistudio/sessions/one'), legacySessionDirectory);
  await store.projects.updateRuntime(project.id, 'one', 'ready', {
    ...savedSession,
    path: `agents/one/sessions/${savedSession.path.split('/').at(-1)}`,
  });
  const setTeamMode = (workspaceMode: TeamWorkspaceMode) =>
    store.saveSection('agentCatalog', {
      agents: profiles,
      teams: [{ ...team, workspaceMode }],
    });
  const addProject = async (name: string) => {
    const result = await store.command({ kind: 'create', name, teamId: team.id, agents: profiles });
    return store.projects.snapshot(result.selectedId!);
  };
  const resume = async (projectId: string, agentId: string, mode: TeamWorkspaceMode) => {
    const count = modelCalls;
    const before = children.length;
    await host.launch({ projectId, agentId, autoContinue: false });
    assert.equal(await children[before].done, 0);
    if (failure) throw failure;
    const envelope = envelopes.at(-1)!;
    const projectRoot = await store.projects.directory(projectId);
    assert.equal(store.projects.snapshot(projectId).workspaceMode, mode);
    assert.equal(envelope.record.workspaceMode, mode);
    checkWorkspacePrompt(sessionSystemPrompt(envelope), projectRoot, agentId, mode);
    assert.equal(envelope.firstMessage, undefined);
    assert.equal(modelCalls, count, 'Idle exact resume does not replay a task or call a model');
  };
  await setTeamMode('per-agent');
  await resume(project.id, 'one', 'shared');
  await resume(project.id, 'two', 'shared');
  current = await store.projects.read(project.id);
  for (const agent of current.agents) {
    assert.equal(
      await readFile(join(directory, agent.session!.path), 'utf8'),
      histories.get(agent.profile.id),
    );
    assert.ok(agent.session?.path.startsWith(`.pistudio/sessions/${agent.profile.id}/`));
  }
  const separate = await addProject('Separate project');
  assert.equal(separate.workspaceMode, 'per-agent');
  separateDirectory = await store.projects.directory(separate.id);
  await host.launch({
    projectId: separate.id,
    agentId: 'two',
    autoContinue: false,
    firstMessage: 'TASK_SEPARATE_TWO',
  });
  assert.equal(await children.at(-1)!.done, 0);
  if (failure) throw failure;
  const session = store.projects.snapshot(separate.id).agents[1].session!;
  const separateHistory = await readFile(join(separateDirectory, session.path), 'utf8');
  const separateManifest = await readFile(join(separateDirectory, 'project.json'));
  await setTeamMode('shared');
  await resume(separate.id, 'two', 'per-agent');
  assert.deepEqual(await readFile(join(separateDirectory, 'project.json')), separateManifest);
  assert.equal(await readFile(join(separateDirectory, session.path), 'utf8'), separateHistory);
  assert.equal(
    await readFile(join(separateDirectory, 'agents/two/output/two.txt'), 'utf8'),
    'RESULT_two',
  );
  assert.equal((await addProject('New shared project')).workspaceMode, 'shared');
  await writeFile(
    'artifacts/team-workspace-pi-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        nativePi: pi.version,
        loopbackModelOnly: true,
        concurrentAgentsShareActualProjectRoot: true,
        noOutputOrAgentWorkFoldersInSharedProject: true,
        sessionsAlwaysInHiddenProjectSessionsByStableAgentId: true,
        runtimeLeasesRemainSeparate: true,
        rootDeliverablesWrittenAndValidated: true,
        legacySessionDirectoryMigratedWithoutTranscriptChanges: true,
        teamModeAppliesOnlyToNewProjects: true,
        existingProjectPromptPathsAndTranscriptsPreservedAcrossBothModeChanges: true,
        idleResumeModelCalls: 0,
        limits:
          'Disposable studio and installed Pi SDK/production bridge with a loopback model; no external model requests, production app changes, visible desktop or Windows acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Native Pi team workspace passed: project settings, prompt paths and histories survive team mode changes in both directions.',
  );
} finally {
  clearTimeout(timer);
  host.close();
  for (const child of children) if (child.process.exitCode === null) child.process.kill('SIGTERM');
  await Promise.allSettled(children.map((child) => child.done));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(root, { recursive: true, force: true });
}
