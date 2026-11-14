import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { productionTools } from '../src/main/pi/RunChannel.ts';
import { libraryTools, libraryTool } from '../src/main/library/tools.ts';
import { libraryPng } from './fixtures/library.mjs';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../src/main/pi/RunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { getProviderStatus } from '../src/main/pi/provider.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

// Opt-in integration: one short real subscription request in an isolated studio, then exact resume.
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-live-session-'));
const checkLibrary = process.argv.includes('--library');
const service = new StudioService(join(temporary, 'preferences.json'), join(temporary, 'Studio'));
const pi = await checkPi('');
assert.equal((await getProviderStatus(pi.path, 'openai-codex')).status, 'ready');
const agent: Agent = {
  id: 'qa-agent',
  name: 'Session smoke',
  enabled: true,
  skills: [],
  mcps: ['qa-mcp', ...(checkLibrary ? ['pistudio-library'] : [])],
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
  `import { Type } from 'typebox'; export default function(pi) { pi.registerTool({name:'qa_package_value',label:'QA package value',description:'Return the isolated package test token',parameters:Type.Object({}),async execute(){return {content:[{type:'text',text:${JSON.stringify(packageToken)}}]};}}); }`,
);
await writeFile(
  join(packageRoot, 'skill/SKILL.md'),
  `---\nname: qa-resource\ndescription: Contains the isolated skill test token\n---\n\nSkill test token: ${skillToken}\n`,
);
const external = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let content = '';
  for await (const chunk of request) content += chunk;
  const data = JSON.parse(content);
  if (!('id' in data)) {
    response.writeHead(202);
    response.end();
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
  tools: [...productionTools, ...libraryTools],
  tool: (run, name, args) => libraryTool(service, run, name, args),
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
  const pngInput = join(temporary, 'qa-library-reference.png');
  if (checkLibrary) await writeFile(pngInput, libraryPng());
  const libraryRequest = checkLibrary
    ? ` Also check the library publication pipeline: read library_get_contract, then library_prepare_asset for kind locations with title QA location. In the returned stagingDirectory, use native bash to copy the provided PNG ${JSON.stringify(pngInput)} to reference.png and preview.png; write a simple safe static scene.svg with a circle, and add files.vector="scene.svg" in the prepared asset.json without changing id/kind/version/createdAt. Call library_validate_asset and library_publish_asset with that preparation token. Use native bash to write the returned manifest id and version into output/library-result.json as {"id":"...","version":1}. Do not create extra assets.`
    : '';
  const outputs = [
    'hello.txt',
    'project-root.txt',
    'resources.json',
    ...(checkLibrary ? ['library-result.json'] : []),
  ];
  const started = await host.launch({
    projectId,
    agentId: agent.id,
    autoContinue: false,
    firstMessage: `Use the Pi Studio internal MCP list_project_files tool to list ${earlierOutput}, then its read_project_file tool to read ${earlierOutput}/brief.md. That file contains one token. Call the assigned package tool qa_package_value and the assigned external MCP tool external_value. Read the assigned qa-resource skill to get its skill test token. Use native bash (not write/edit) to create output/resources.json with exactly {"package":"<package token>","mcp":"<external MCP token>","skill":"<skill test token>"}, and output/hello.txt with exactly the brief token and a newline. Also use bash to write the absolute Project directory stated in your system prompt to output/project-root.txt with a newline.${libraryRequest} Finally call Pi Studio complete_stage with outputs ${JSON.stringify(outputs)}. Perform only these checks.`,
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
  if (checkLibrary) {
    const listing = await store.library.list();
    assert.equal(listing.assets.length, 1);
    const saved = JSON.parse(
      await readFile(join(root, agentOutput, 'library-result.json'), 'utf8'),
    );
    assert.equal(saved.id, listing.assets[0].id);
    assert.equal(saved.version, 1);
    assert.equal(listing.assets[0].library.kind, 'locations');
    const asset = await store.library.get('locations', saved.id, 1);
    assert.deepEqual(await readFile(join(asset.directory, 'reference.png')), libraryPng());
  }
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
  if (checkLibrary)
    for (const name of [
      'library_get_contract',
      'library_prepare_asset',
      'library_validate_asset',
      'library_publish_asset',
    ]) {
      assert.ok(
        calls.some((call) => call.name === `mcp__pi_studio__${name}`),
        `Pi must actually invoke ${name}`,
      );
      assert.ok(
        messages.some(
          (message) =>
            message.role === 'toolResult' &&
            message.toolName === `mcp__pi_studio__${name}` &&
            !message.isError,
        ),
        `${name} must actually succeed`,
      );
    }
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
  for (const id of [started.runId, resumed.runId]) {
    const context = await readFile(join(root, '.pistudio/context', id, 'context.json'), 'utf8');
    assert.equal(context.includes(agent.mainInstruction!), false);
    assert.equal(context.includes(token), false);
    assert.equal(context.includes(skillToken), false);
  }
  console.log(
    'Real Pi session passed: assigned package tool + packaged skill + external MCP in the same session, native bash, internal project file access, explicit project root, validated completion and exact empty resume without instruction copies.',
  );
  if (checkLibrary)
    console.log(
      'Real Pi library passed: native bash writes prepared PNG/SVG data, MCP validates/publishes one asset, pinned version is readable and exact resume does not publish again.',
    );
} finally {
  host.close();
  await Promise.allSettled(children);
  external.closeAllConnections();
  external.close();
  await rm(temporary, { recursive: true, force: true });
}
