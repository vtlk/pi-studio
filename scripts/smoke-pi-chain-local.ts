import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';
import { importSkill } from '../src/main/storage/skills.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-chain-local-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const steps = new Map<string, number>();
const directSkillPaths: Record<string, string> = {};
let packageSkillPath = '';
let requests = 0;
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(body.model, 'qa-chain');
    const system = JSON.stringify(
      body.messages.filter((m: { role: string }) => m.role === 'system'),
    );
    const stage = system.includes('QA_STAGE:last_v2')
      ? 'last'
      : system.includes('QA_STAGE:first')
        ? 'first'
        : '';
    assert.ok(stage, 'Fresh role is delivered through the native system prompt');
    assert.equal(system.includes('QA_STAGE:last_v1'), false);
    assert.ok(system.includes('Filesystem and instruction scope rules'));
    assert.ok(system.includes('not only the earlier agents'));
    assert.ok(
      system.includes(
        'Do not browse, grep, find or recursively search the setup-assistant workspace',
      ),
    );
    assert.ok(system.includes('only that exact assigned skill directory'));
    assert.ok(system.includes(directSkillPaths[stage]));
    assert.equal(system.includes(directSkillPaths[stage === 'first' ? 'last' : 'first']), false);
    assert.equal(system.includes(packageSkillPath), stage === 'first');
    assert.equal(system.includes('QA_NEW_ENABLED_INSTRUCTION'), stage === 'last');
    const step = steps.get(stage) ?? 0;
    steps.set(stage, step + 1);
    requests++;
    assert.ok(step < 3, 'No unexpected model retry or additional turn');
    const tools = body.tools.map((t: { function: { name: string } }) => t.function);
    let tool: { name: string } | undefined, args;
    if (step === 0) {
      tool = tools.find((t: { name: string }) => t.name === 'bash');
      args = {
        command:
          stage === 'first'
            ? "printf 'LOCAL_CHAIN_FIRST_OK' > output/result.txt"
            : 'test "$(cat ../first/output/result.txt)" = LOCAL_CHAIN_FIRST_OK && printf \'LOCAL_CHAIN_LAST_OK\' > output/result.txt',
      };
    } else if (step === 1) {
      tool = tools.find((t: { name: string }) => t.name.endsWith('complete_stage'));
      args = { outputs: ['result.txt'] };
      assert.ok(tool, 'Actual native MCP direct tool is exposed');
      if (stage === 'first') {
        const current = store.bootstrap().sections.agents as Agent[];
        await store.saveSection(
          'agents',
          current.map((a) =>
            a.id === 'last'
              ? {
                  ...a,
                  mainInstruction: 'QA_STAGE:last_v2',
                  instructions: a.instructions.map((block) => ({ ...block, enabled: true })),
                }
              : a,
          ),
        );
      }
    }
    if (step < 2) assert.ok(tool, 'Native bash/complete_stage is available');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-${stage}-${step}`,
              type: 'function',
              function: { name: tool.name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: 'assistant', content: 'Task completed.' };
    const item = (delta: object, finish_reason: string | null) => ({
      id: `chain-${stage}-${step}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qa-chain',
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
    res.write(
      `data: ${JSON.stringify({ ...item({}, tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    );
    res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end('QA fixture rejected request');
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const connection = {
  id: 'qa-chain',
  name: 'Local chain fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-chain'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-chain',
        name: 'QA chain',
        imageInput: false,
        reasoning: false,
        contextWindow: 16384,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const directSkills: Record<string, Resource> = {};
for (const stage of ['first', 'last']) {
  const path = join(store.folder, '.pistudio/setup-assistant', `qa-${stage}-skill`);
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, 'SKILL.md'),
    `---\nname: qa-${stage}-skill\ndescription: Session-scoped QA skill\n---\nUse only your assigned project files.\n`,
  );
  const resource = await importSkill(path, []);
  directSkills[stage] = resource;
  directSkillPaths[stage] = resource.source;
}
const packageFolder = join(store.folder, '.pistudio/setup-assistant/qa-package');
packageSkillPath = join(packageFolder, 'skills/qa-package-skill');
await mkdir(packageSkillPath, { recursive: true });
await writeFile(
  join(packageFolder, 'package.json'),
  JSON.stringify({
    name: 'qa-skill-package',
    version: '1.0.0',
    pi: { skills: ['./skills/qa-package-skill'] },
  }),
);
await writeFile(
  join(packageSkillPath, 'SKILL.md'),
  '---\nname: qa-package-skill\ndescription: Assigned package skill\n---\nStay within the current session scope.\n',
);
const packageResource: Resource = {
  id: 'qa-package',
  name: 'QA package',
  kind: 'plugins',
  source: packageFolder,
  version: '1.0.0',
  description: 'QA only',
  transport: '',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
await store.saveSection('resources', [...Object.values(directSkills), packageResource]);
const agents: Agent[] = ['first', 'skip', 'last'].map((id) => ({
  id,
  name: id === 'first' ? 'First' : id === 'last' ? 'Last' : 'Skip',
  enabled: id !== 'skip',
  instructions:
    id === 'last'
      ? [
          {
            id: 'fresh-block',
            name: 'Fresh instruction',
            content: 'QA_NEW_ENABLED_INSTRUCTION',
            enabled: false,
          },
        ]
      : [],
  skills: directSkills[id] ? [directSkills[id].id] : [],
  mcps: [],
  plugins: id === 'first' ? [packageResource.id] : [],
  mainInstruction: `QA_STAGE:${id === 'last' ? 'last_v1' : id}`,
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-chain',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agents', agents);
const project = (await store.command({ kind: 'create', name: 'Native local chain', agents }))
  .projects[0];
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge:
    process.env.PI_STUDIO_QA_BRIDGE ||
    new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    children.push(
      new Promise((r, reject) => {
        child.once('error', reject);
        child.once('exit', r);
      }),
    );
  },
});
try {
  await host.launch({
    projectId: project.id,
    agentId: 'first',
    firstMessage: 'Run the two-stage local chain task.',
    autoContinue: true,
  });
  const end = Date.now() + 40000;
  let current = await store.projects.read(project.id);
  while (current.agents[2].runStatus !== 'ready' && Date.now() < end) {
    if (current.agents.some((a) => a.runStatus === 'error'))
      throw Error('Native local chain failed');
    await new Promise((r) => setTimeout(r, 50));
    current = await store.projects.read(project.id);
  }
  assert.equal(current.agents[0].runStatus, 'ready');
  assert.equal(current.agents[2].runStatus, 'ready');
  assert.equal(current.agents[1].session, undefined);
  assert.equal(children.length, 2);
  assert.deepEqual(await Promise.all([...children]), [0, 0]);
  assert.equal(requests, 6);
  const directory = await store.projects.directory(project.id);
  assert.equal(
    await readFile(join(directory, current.agents[0].outputPath, 'result.txt'), 'utf8'),
    'LOCAL_CHAIN_FIRST_OK',
  );
  assert.equal(
    await readFile(join(directory, current.agents[2].outputPath, 'result.txt'), 'utf8'),
    'LOCAL_CHAIN_LAST_OK',
  );
  const selected = [current.agents[0], current.agents[2]];
  const messages = async (path: string) =>
    (await readFile(join(directory, path), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'message');
  const before = await Promise.all(selected.map((a) => messages(a.session!.path)));
  for (const entries of before)
    assert.equal(entries.filter((e) => e.message.role === 'user').length, 1);
  const contextRoot = join(directory, '.pistudio/context');
  const records = await Promise.all(
    (await readdir(contextRoot)).map(async (id) => {
      const text = await readFile(join(contextRoot, id, 'context.json'), 'utf8');
      assert.equal(
        text.includes('QA_STAGE:'),
        false,
        'No instruction text copied into context metadata',
      );
      assert.equal(text.includes('QA_NEW_ENABLED_INSTRUCTION'), false);
      return JSON.parse(text);
    }),
  );
  assert.deepEqual(records.map((r) => r.agentId).sort(), ['first', 'last']);
  assert.deepEqual(records.find((r) => r.agentId === 'last').instructionIds, ['fresh-block']);
  assert.equal(
    records.find((r) => r.agentId === 'last').previousOutputs[0].path,
    join(directory, current.agents[0].outputPath),
  );
  await host.launch({ projectId: project.id, agentId: 'first', autoContinue: true });
  assert.equal(await children[2], 0);
  assert.equal(children.length, 3);
  assert.equal(requests, 6);
  assert.deepEqual(await Promise.all(selected.map((a) => messages(a.session!.path))), before);
  const reopened = await store.projects.read(project.id);
  assert.equal(reopened.agents[0].session!.path, selected[0].session!.path);
  assert.equal(
    (await readdir(contextRoot)).length,
    3,
    'Idle resume builds a fresh context package',
  );
  const proof = {
    passed: true,
    pi: pi.version,
    nativeBashAndMcpCompletion: true,
    disabledStageSkipped: true,
    currentRoleAtHandoff: true,
    newlyEnabledInstructionDeliveredAtHandoff: true,
    scopeRulesReceivedInNativeSystemPrompt: true,
    assignedHelperNestedSkillsOnly: true,
    assignedPackageSkillsScoped: true,
    hardFilesystemSandbox: false,
    packagedBridge: !!process.env.PI_STUDIO_QA_BRIDGE,
    freshContextWithoutInstructionCopies: true,
    previousOutputReadByNextAgent: true,
    oneUserMessagePerStage: true,
    armedIdleResumeNoReplay: true,
    idleResumeFreshContextAndExactBinding: true,
    localModelRequests: requests,
    externalModelRequests: 0,
    scope:
      'Actual Pi SDK/production RunHost/bridge with synthetic local OpenAI SSE tools; no Terminal UI or user studio changes.',
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/local-chain-proof.json'),
    JSON.stringify(
      {
        ...JSON.parse(
          await readFile(resolve('artifacts/local-chain-proof.json'), 'utf8').catch(() => '{}'),
        ),
        latestNativeControl: { checkedAt: new Date().toISOString(), result: proof },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  host.close();
  await Promise.allSettled(children);
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(root, { recursive: true, force: true });
}
