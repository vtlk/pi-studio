import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { productionTools } from '../src/main/pi/RunChannel.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../src/main/pi/RunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { getProviderStatus } from '../src/main/pi/provider.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

// Opt-in integration: one short real subscription request in an isolated studio, then exact resume.
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-live-session-'));
const service = new StudioService(join(temporary, 'preferences.json'), join(temporary, 'Studio'));
const pi = await checkPi('');
assert.equal((await getProviderStatus(pi.path, 'openai-codex')).status, 'ready');
const agent: Agent = {
  id: 'qa-agent',
  name: 'Session smoke',
  enabled: true,
  skills: [],
  mcps: ['qa-mcp'],
  plugins: ['qa-package'],
  instructions: [],
  mainInstruction:
    'Follow the user precisely. Write deliverables in output and signal completion through Pi Studio MCP.',
  model: {
    connectionId: 'qa-connection',
    provider: 'openai-codex',
    id: 'gpt-6.1-sol',
    reasoning: 'Низкий',
    temperature: '',
  },
};
const store = await service.load();
const earlier = { ...agent, id: 'previous', name: 'Earlier agent' };
const constructor = [earlier, agent];
await store.saveSection('agents', constructor);
const created = await store.command({
  kind: 'create',
  name: 'Live SDK check',
  agents: constructor,
});
const projectId = created.selectedId!;
const root = await store.projects.directory(projectId);
const earlierOutput = created.projects[0].agents.find(
  (item) => item.profile.id === earlier.id,
)!.outputPath;
const agentOutput = created.projects[0].agents.find(
  (item) => item.profile.id === agent.id,
)!.outputPath;
const agentSessions = agentOutput.replace(/\/output$/, '/sessions');
const token = `PISTUDIO_REAL_SESSION_${randomUUID()}`;
await writeFile(join(root, earlierOutput, 'brief.md'), `${token}\n`);
const packageToken = randomUUID(),
  skillToken = randomUUID(),
  mcpToken = randomUUID();
const packageRoot = join(temporary, 'package');
const loadReport = join(temporary, 'resource-loads.jsonl');
const descriptions = ['QA_CURRENT_SKILL_DESCRIPTION_ONE', 'QA_CURRENT_SKILL_DESCRIPTION_TWO'];
await mkdir(join(packageRoot, 'skill'), { recursive: true });
await writeFile(
  join(packageRoot, 'package.json'),
  JSON.stringify({
    name: 'qa-pi-package',
    version: '1.0.0',
    pi: { extensions: ['./extension.ts'], skills: ['./skill'] },
    peerDependencies: { typebox: '*' },
  }),
);
await writeFile(
  join(packageRoot, 'extension.ts'),
  `import { Type } from 'typebox'; import {appendFile} from 'node:fs/promises';
export default function(pi) {
  pi.registerTool({name:'qa_package_value',label:'QA package value',description:'Return the isolated package test token',parameters:Type.Object({}),async execute(){return {content:[{type:'text',text:${JSON.stringify(packageToken)}}]};}});
  pi.on('session_start',async(_event,ctx)=>{
    const prompt=ctx.getSystemPrompt();
    await appendFile(${JSON.stringify(loadReport)},JSON.stringify({
      packageTool:pi.getAllTools().some(tool=>tool.name==='qa_package_value'),
      firstDescription:prompt.includes(${JSON.stringify(descriptions[0])}),
      secondDescription:prompt.includes(${JSON.stringify(descriptions[1])}),
      unassignedSkill:prompt.includes('QA_UNASSIGNED_CWD_SKILL')
    })+'\\n');
  });
}`,
);
await writeFile(
  join(packageRoot, 'skill/SKILL.md'),
  `---\nname: qa-resource\ndescription: ${descriptions[0]}\n---\n\nSkill test token: ${skillToken}\n`,
);
const unassigned = join(root, agentOutput, '../.pi');
const leakedExtension = join(temporary, 'unassigned-extension-loaded');
await mkdir(join(unassigned, 'skills/unassigned'), { recursive: true });
await mkdir(join(unassigned, 'extensions'), { recursive: true });
await writeFile(
  join(unassigned, 'skills/unassigned/SKILL.md'),
  '---\nname: qa-unassigned\ndescription: QA_UNASSIGNED_CWD_SKILL\n---\n\nNever load automatically.',
);
await writeFile(
  join(unassigned, 'extensions/leak.ts'),
  `import {writeFile} from 'node:fs/promises'; export default function(){void writeFile(${JSON.stringify(leakedExtension)},'unexpected');}`,
);
let listed = 0,
  invoked = 0,
  mcpUnavailable = false;
const external = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let content = '';
  for await (const chunk of request) content += chunk;
  const data = JSON.parse(content);
  if (data.method === 'tools/list') listed++;
  if (data.method === 'tools/call') invoked++;
  if (!('id' in data)) {
    response.writeHead(202);
    response.end();
    return;
  }
  if (mcpUnavailable) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: data.id,
        error: { code: -32603, message: 'QA_MCP_UNAVAILABLE' },
      }),
    );
    return;
  }
  const result =
    data.method === 'initialize'
      ? {
          protocolVersion: data.params.protocolVersion,
          serverInfo: { name: 'QA external', version: '1' },
          capabilities: { tools: {} },
        }
      : data.method === 'tools/list'
        ? {
            tools: [
              {
                name: 'external_value',
                description: 'Return isolated MCP test token',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          }
        : { content: [{ type: 'text', text: mcpToken }] };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
});
await new Promise<void>((resolve) => external.listen(0, '127.0.0.1', resolve));
const address = external.address();
assert.ok(address && typeof address !== 'string');
const resourceBase = {
  version: '',
  description: '',
  transport: '',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
const resources: Resource[] = [
  {
    ...resourceBase,
    id: 'qa-package',
    name: 'QA local package',
    kind: 'plugins',
    source: packageRoot,
  },
  {
    ...resourceBase,
    id: 'qa-mcp',
    name: 'QA external MCP',
    kind: 'mcps',
    source: `http://127.0.0.1:${address.port}/mcp`,
    transport: 'HTTP',
  },
];
await store.saveSection('resources', resources);
const children: Promise<number | null>[] = [];
const host = new RunHost({
  tools: productionTools,
  bootstraps: join(temporary, 'bootstraps'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  headless: true,
  prepare: async (request) => ({
    run: await buildRunContext(
      await store.projects.directory(projectId),
      await store.projects.read(projectId),
      request.agentId,
      constructor,
      resources,
    ),
    piPath: pi.path,
  }),
  update: (run, status, session) =>
    store.projects.updateRuntime(run.project.id, run.agent.profile.id, status, session),
  read: (run) => store.projects.read(run.project.id),
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    child.stderr.on('data', () => {}); // Do not print provider output or credentials.
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
try {
  const outputs = ['hello.txt', 'project-root.txt', 'resources.json'];
  const started = await host.launch({
    projectId,
    agentId: agent.id,
    autoContinue: false,
    firstMessage: `Use the Pi Studio internal MCP list_project_files tool to list ${earlierOutput}, then its read_project_file tool to read ${earlierOutput}/brief.md. That file contains one token. Call the assigned package tool qa_package_value and the assigned external MCP tool external_value. Read the assigned qa-resource skill to get its skill test token. Use native bash (not write/edit) to create output/resources.json with exactly {"package":"<package token>","mcp":"<external MCP token>","skill":"<skill test token>"}, and output/hello.txt with exactly the brief token and a newline. Also use bash to write the absolute Project directory stated in your system prompt to output/project-root.txt with a newline. Finally call Pi Studio complete_stage with outputs ${JSON.stringify(outputs)}. Perform only these checks.`,
  });
  assert.ok(started.project.agents.find((item) => item.profile.id === agent.id)?.session);
  const firstExit = await children[0];
  assert.equal(firstExit, 0, 'Pi bridge must complete normally');
  const finished = await store.projects.read(projectId);
  assert.equal(finished.agents.find((item) => item.profile.id === agent.id)?.runStatus, 'ready');
  const binding = finished.agents.find((item) => item.profile.id === agent.id)!.session!;
  assert.equal(await readFile(join(root, agentOutput, 'hello.txt'), 'utf8'), `${token}\n`);
  assert.equal(await readFile(join(root, agentOutput, 'project-root.txt'), 'utf8'), `${root}\n`);
  const transcript = await readFile(join(root, binding.path), 'utf8');
  assert.deepEqual(JSON.parse(await readFile(join(root, agentOutput, 'resources.json'), 'utf8')), {
    package: packageToken,
    mcp: mcpToken,
    skill: skillToken,
  });
  const messages = transcript
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .map((entry) => entry.message)
    .filter(Boolean);
  const calls = messages.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter((block: { type: string }) => block.type === 'toolCall')
      : [],
  );

  assert.ok(
    calls.some((call) => call.name === 'bash'),
    'Native bash must actually be called',
  );
  for (const tool of [
    'list_project_files',
    'read_project_file',
    'qa_package_value',
    'external_value',
  ])
    assert.ok(
      calls.some((call) => call.name.endsWith(tool)),
      `Native MCP must call ${tool}`,
    );
  assert.ok(
    messages.some(
      (message) => message.role === 'toolResult' && message.toolName === 'bash' && !message.isError,
    ),
    'Native bash must succeed',
  );
  const beforeFiles = await readdir(join(root, agentSessions));
  const firstLoads = (await readFile(loadReport, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(firstLoads.length > 0);
  assert.deepEqual(firstLoads.at(-1), {
    packageTool: true,
    firstDescription: true,
    secondDescription: false,
    unassignedSkill: false,
  });
  const beforeList = listed;
  await writeFile(
    join(packageRoot, 'skill/SKILL.md'),
    `---\nname: qa-resource\ndescription: ${descriptions[1]}\n---\n\nCurrent skill body changed for the next explicit open.\n`,
  );
  const resumed = await host.launch({ projectId, agentId: agent.id, autoContinue: false });
  assert.equal(
    resumed.project.agents.find((item) => item.profile.id === agent.id)?.session?.path,
    binding.path,
  );
  assert.equal(await children[1], 0);
  assert.equal(
    await readFile(join(root, binding.path), 'utf8'),
    transcript,
    'Resume must not add any user message or replay generation',
  );
  assert.deepEqual(await readdir(join(root, agentSessions)), beforeFiles);
  assert.ok(listed > beforeList, 'An explicit resume must reconnect its assigned MCP');
  const resumedLoads = (await readFile(loadReport, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(resumedLoads.length > firstLoads.length);
  assert.deepEqual(resumedLoads.at(-1), {
    packageTool: true,
    firstDescription: false,
    secondDescription: true,
    unassignedSkill: false,
  });
  await assert.rejects(access(leakedExtension), { code: 'ENOENT' });
  for (const id of [started.runId, resumed.runId]) {
    const context = await readFile(join(root, '.pistudio/context', id, 'context.json'), 'utf8');
    assert.equal(context.includes(agent.mainInstruction!), false);
    assert.equal(context.includes(token), false);
    assert.equal(context.includes(skillToken), false);
  }
  agent.capabilitySettings = {
    'plugins:qa-package': { enabled: false },
    'mcps:qa-mcp': { enabled: false },
  };
  await store.command({
    kind: 'update-agents',
    projectId,
    agents: constructor,
    updateExisting: true,
  });
  const disabledList = listed,
    disabledInvocations = invoked;
  const disabled = await host.launch({ projectId, agentId: agent.id, autoContinue: false });
  assert.equal(await children[2], 0);
  assert.equal(listed, disabledList);
  assert.equal(invoked, disabledInvocations);
  assert.equal(
    await readFile(loadReport, 'utf8'),
    resumedLoads.map((item) => JSON.stringify(item)).join('\n') + '\n',
  );
  assert.equal(await readFile(join(root, binding.path), 'utf8'), transcript);
  const disabledContext = JSON.parse(
    await readFile(join(root, '.pistudio/context', disabled.runId, 'context.json'), 'utf8'),
  );
  assert.deepEqual(disabledContext.resourceIds.plugins, []);
  assert.ok(!disabledContext.resourceIds.mcps.includes('qa-mcp'));
  await assert.rejects(access(leakedExtension), { code: 'ENOENT' });
  agent.capabilitySettings = {};
  await store.command({
    kind: 'update-agents',
    projectId,
    agents: constructor,
    updateExisting: true,
  });
  mcpUnavailable = true;
  const failed = host.launch({ projectId, agentId: agent.id, autoContinue: false });
  await Promise.allSettled([failed]);
  assert.equal(await children[3], 1, 'An assigned failed MCP must stop the bridge before work');
  assert.equal(
    (await store.projects.read(projectId)).agents.find((item) => item.profile.id === agent.id)
      ?.runStatus,
    'error',
  );
  assert.equal(
    invoked,
    disabledInvocations,
    'A failed resume must never invoke model-selected tools',
  );
  assert.equal(await readFile(join(root, binding.path), 'utf8'), transcript);
  console.log(
    'Real Pi session passed: actual package/skill/MCP use, native bash and project file reads; explicit resume reloads current skill and MCP; disabled assignments and unassigned cwd resources stay absent; failed MCP stops before work; exact history and no instruction copies.',
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  external.closeAllConnections();
  external.close();
  await rm(temporary, { recursive: true, force: true });
}
