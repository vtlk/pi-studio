import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { ModelConnections } from '../src/main/pi/ModelConnections.ts';
import { BrowserAuth, resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { connectionAuthScope } from '../src/main/pi/modelAuth.ts';
import { ProjectActivity } from '../src/main/pi/ProjectActivity.ts';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import { nativeExtensionPaths } from '../bundled/pi-bridge/native-extensions.mjs';
import { createConnectionServices } from '../bundled/pi-bridge/connection-runtime.mjs';
import type { Agent } from '../src/shared/studio.ts';
import type { Connection } from '../src/shared/connections.ts';

// Actual installed Pi/public SDK/Studio adapter. All credentials and modules are owned fixtures;
// one explicit input drives four loopback HTTP tool turns, with no cloud/model/auth service.
const computer = new ComputerSupport();
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-native-extensions-')));
const previous = { ...process.env },
  children: { process: ReturnType<typeof spawn>; exit: Promise<number | null> }[] = [];
const native = join(root, 'NativePi'),
  scripts = new URL('../bundled/pi-bridge/', import.meta.url).pathname;
let host: ReturnType<typeof createStudioRunHost> | undefined, auth: BrowserAuth | undefined;
let activityTimer: ReturnType<typeof setInterval> | undefined;
let httpRequests = 0,
  fixtureError: unknown;
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer qa-extension-one');
    assert.equal(body.model, 'fixture-extension-model');
    assert.doesNotMatch(
      JSON.stringify(body.messages),
      /UNASSIGNED_SKILL_TEXT|UNASSIGNED_PROMPT_TEXT|UNASSIGNED_SYSTEM_PROMPT_TEXT/,
    );
    const names = body.tools.map((tool) => tool.function.name);
    assert.ok(names.includes('native_extension_probe'));
    assert.ok(names.includes('native_package_probe'));
    assert.ok(!names.some((name) => /global_mcp_leak|disabled_extension/.test(name)));
    const step = httpRequests++;
    assert.ok(step < 4, 'No retry or unexpected extra model turn.');
    const tool =
      step === 0
        ? names.find(
            (name) => name.includes('pi_studio_computer') && name.endsWith('check_permissions'),
          )
        : step === 1
          ? 'native_extension_probe'
          : step === 2
            ? names.find((name) => name.endsWith('complete_stage'))
            : undefined;
    if (step < 3)
      assert.ok(tool, 'Mandatory Pi Studio and Computer MCP survive native extensions.');
    if (step === 1) assert.match(JSON.stringify(body.messages), /permissions_required|ready/);
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `extension-${step}`,
              type: 'function',
              function: {
                name: tool,
                arguments: JSON.stringify(step === 2 ? { outputs: ['result.txt'] } : {}),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Native extension completed.' };
    const item = (delta, finish_reason) => ({
      id: `extension-${step}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
    res.end(
      `data: ${JSON.stringify({ ...item({}, tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    fixtureError = error;
    res.writeHead(500);
    res.end('QA fixture rejected request');
  }
});
const until = async <T>(read: () => Promise<T> | T, match: (value: T) => boolean) => {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (match(value)) return value;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw Error('Native extension condition timed out.');
};
try {
  await mkdir(join(native, 'extensions'), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = native;
  process.env.PI_OFFLINE = '1';
  process.env.PI_TELEMETRY = '0';
  process.env.QA_NATIVE_EXT_KEY = 'qa-extension-ambient-must-not-be-used';
  const pi = await checkPi(''),
    sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const marker = join(root, 'native-events.txt'),
    mcpLeak = join(root, 'unassigned-mcp-started');
  await writeFile(
    join(native, 'extensions/provider.js'),
    `import {appendFileSync,writeFileSync} from 'node:fs';
export default function(pi) {
  console.log('UNSTRUCTURED_EXTENSION_OUTPUT');
  pi.registerProvider('studio-native-fixture', {name:'Native fixture',baseUrl:'http://127.0.0.1:${port}/v1',api:'openai-completions',apiKey:'$QA_NATIVE_EXT_KEY',authHeader:true,
    models:[{id:'fixture-extension-model',name:'Native extension model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}]});
  pi.registerProvider({id:'studio-native-object',name:'Native object',
    auth:{oauth:{name:'Fixture OAuth',loginLabel:'Fixture native OAuth',isSubscription:true,
      async login(){return {type:'oauth',access:'qa-native-object',refresh:'qa-refresh',expires:Date.now()+3600000};},
      async refresh(credential){return {...credential,expires:Date.now()+3600000};},async toAuth(credential){return {apiKey:credential.access};}}},
    getModels(){return [{id:'native-object-model',name:'Native object model',provider:'studio-native-object',api:'openai-completions',baseUrl:'http://127.0.0.1:${port}/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:1024}];},
    stream(){throw Error('No native-object model request belongs in catalog QA');},streamSimple(){throw Error('No native-object model request belongs in catalog QA');}});
  pi.registerTool({name:'native_extension_probe',label:'Native probe',description:'Owned extension fixture',parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(id,args,signal,update,ctx){writeFileSync(ctx.cwd+'/output/result.txt','NATIVE_EXTENSION_OK');return {content:[{type:'text',text:'Output written.'}],details:{}};}});
  for(const name of ['session_start','agent_start','agent_settled'])pi.on(name,()=>appendFileSync(${JSON.stringify(marker)},name+'\\n'));
}
`,
  );
  const disabled = join(native, 'extensions/disabled.js');
  await writeFile(
    disabled,
    `export default function(){throw Error('DISABLED_EXTENSION_EXECUTED');}`,
  );
  const pkg = join(root, 'native-mixed-package');
  await mkdir(join(pkg, 'skill'), { recursive: true });
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'qa-native-mixed',
      pi: { extensions: ['./extension.js'], skills: ['./skill'], prompts: ['./prompt.md'] },
    }),
  );
  await writeFile(
    join(pkg, 'extension.js'),
    `export default function(pi){pi.registerTool({name:'native_package_probe',label:'Package probe',description:'Owned package extension',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'ok'}],details:{}};}});}`,
  );
  await writeFile(
    join(pkg, 'skill/SKILL.md'),
    '---\nname: unassigned-skill\ndescription: Not assigned\n---\nUNASSIGNED_SKILL_TEXT',
  );
  await writeFile(join(pkg, 'prompt.md'), 'UNASSIGNED_PROMPT_TEXT');
  await writeFile(
    join(native, 'settings.json'),
    JSON.stringify({
      packages: [pkg, 'npm:qa-missing-never-install'],
      extensions: ['-' + disabled],
    }),
  );
  await writeFile(join(native, 'SYSTEM.md'), 'UNASSIGNED_SYSTEM_PROMPT_TEXT');
  await writeFile(
    join(native, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        global_mcp_leak: {
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(mcpLeak)},'LEAK')`],
        },
      },
    }),
  );
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio')),
    store = await service.load();
  const connections: Connection[] = ['one', 'two', 'object'].map((id) => ({
    id,
    name: id,
    purpose: 'pi',
    providerId: id === 'object' ? 'studio-native-object' : 'studio-native-fixture',
    authScope: 'connection',
    endpoint: '',
    account: '',
    createdAt: 1,
  }));
  await store.saveSection('connections', connections);
  auth = new BrowserAuth(join(scripts, 'login.mjs'), async () => {
    throw Error('API-key fixture must not open browser');
  });
  const models = new ModelConnections(
    service,
    join(root, 'model-auth'),
    scripts,
    () => pi.path,
    auth,
  );
  const request = (id) => ({ folder: store.folder, connectionId: id });
  const catalog = await models.catalog();
  assert.ok(
    catalog.models.some(
      (model) =>
        model.provider === 'studio-native-fixture' && model.id === 'fixture-extension-model',
    ),
  );
  assert.ok(
    catalog.models.some(
      (model) => model.provider === 'studio-native-object' && model.id === 'native-object-model',
    ),
  );
  const scopedCatalog = await models.catalog(request('one'));
  assert.equal(
    scopedCatalog.providers.find((provider) => provider.id === 'studio-native-fixture')?.configured,
    false,
    'A scoped account does not borrow the extension env key.',
  );
  assert.deepEqual(
    scopedCatalog.providers.find((provider) => provider.id === 'studio-native-fixture')
      ?.loginMethods,
    [{ id: 'api_key', label: 'API key' }],
  );
  assert.equal((await models.status(request('one'))).status, 'not_ready');
  assert.deepEqual(
    scopedCatalog.providers.find((provider) => provider.id === 'studio-native-object')
      ?.loginMethods,
    [{ id: 'oauth', label: 'Fixture native OAuth' }],
  );
  const objectLogin = await models.login({ ...request('object'), method: 'oauth' });
  assert.equal(
    (
      await until(
        () => auth!.read(objectLogin.id),
        (state) => ['ready', 'error'].includes(state.phase),
      )
    ).phase,
    'ready',
  );
  assert.equal((await models.status(request('object'))).status, 'ready');
  for (const id of ['one', 'two']) {
    const login = await models.login({ ...request(id), method: 'api_key' });
    const prompt = await until(
      () => auth!.read(login.id),
      (state) => !!state.prompt || state.phase === 'error',
    );
    assert.equal(
      prompt.phase,
      'waiting',
      'Extension stdout must not corrupt the login event channel.',
    );
    assert.equal(prompt.prompt!.secret, true);
    auth.answer(login.id, prompt.prompt!.id, 'qa-extension-' + id);
    const done = await until(
      () => auth!.read(login.id),
      (state) => ['ready', 'error'].includes(state.phase),
    );
    assert.equal(done.phase, 'ready');
  }
  const scope = await connectionAuthScope(join(root, 'model-auth'), store.folder, connections[0]);
  const services = await createConnectionServices(sdk, scope, store.folder);
  assert.doesNotMatch(
    services.resourceLoader.getSystemPrompt() ?? '',
    /UNASSIGNED_SYSTEM_PROMPT_TEXT/,
  );
  assert.equal(services.resourceLoader.getSkills().skills.length, 0);
  assert.equal(services.resourceLoader.getPrompts().prompts.length, 0);
  assert.equal(
    (await services.modelRuntime.getAuth('studio-native-fixture'))?.auth.apiKey,
    'qa-extension-one',
  );
  const projectLocal = join(root, 'ProjectLocal');
  await mkdir(join(projectLocal, '.pi/extensions'), { recursive: true });
  const localFile = join(projectLocal, '.pi/extensions/local.js');
  await writeFile(localFile, 'export default function(){}');
  assert.ok(
    !(await nativeExtensionPaths(sdk, projectLocal)).includes(localFile),
    'Untrusted local extension code stays gated by native trust.',
  );
  new sdk.ProjectTrustStore(native).set(projectLocal, true);
  assert.ok((await nativeExtensionPaths(sdk, projectLocal)).includes(localFile));
  assert.ok(!(await nativeExtensionPaths(sdk, store.folder)).includes(disabled));
  const profile: Agent = {
    id: 'native-agent',
    name: 'Native agent',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction: 'Run the local extension fixture.',
    model: {
      connectionId: 'one',
      provider: 'studio-native-fixture',
      id: 'fixture-extension-model',
      reasoning: 'По умолчанию',
      temperature: '',
    },
  };
  await store.saveSection('agents', [profile]);
  const project = (
    await store.command({ kind: 'create', name: 'Native extension QA', agents: [profile] })
  ).projects[0];
  const activity = new ProjectActivity();
  let observedStart = false;
  activityTimer = setInterval(() => {
    observedStart ||= activity.list().some((item) => item.runningAgents > 0);
  }, 10);
  host = createStudioRunHost(service, {
    computer,
    activity,
    bootstraps: join(root, 'boots'),
    bridge: join(scripts, 'session.mjs'),
    catalog: join(scripts, 'catalog.mjs'),
    piPath: () => pi.path,
    headless: true,
    openTerminal: async (node, bridge, bootstrap) => {
      const child = spawn(node, [bridge, bootstrap], { stdio: 'ignore', env: { ...process.env } });
      children.push({
        process: child,
        exit: new Promise((done, reject) => {
          child.once('error', reject);
          child.once('exit', done);
        }),
      });
    },
  });
  await host.launch({
    projectId: project.id,
    agentId: profile.id,
    autoContinue: false,
    firstMessage:
      'Check Computer Use permissions without prompting or using the desktop; run native_extension_probe, then complete_stage.',
  });
  assert.equal(await children[0].exit, 0);
  clearInterval(activityTimer);
  if (fixtureError) throw fixtureError;
  const updated = await store.projects.read(project.id),
    binding = updated.agents[0].session!;
  assert.equal(updated.agents[0].runStatus, 'ready');
  assert.ok(observedStart);
  assert.deepEqual(activity.list(), []);
  assert.equal(httpRequests, 4);
  const projectRoot = await store.projects.directory(project.id);
  assert.equal(
    await readFile(join(projectRoot, updated.agents[0].outputPath, 'result.txt'), 'utf8'),
    'NATIVE_EXTENSION_OK',
  );
  const canonical = await readFile(join(projectRoot, binding.path), 'utf8');
  await host.launch({ projectId: project.id, agentId: profile.id, autoContinue: false });
  assert.equal(await children[1].exit, 0);
  assert.equal(httpRequests, 4);
  assert.equal(await readFile(join(projectRoot, binding.path), 'utf8'), canonical);
  assert.equal(
    (await readFile(marker, 'utf8')).split('\n').filter((name) => name === 'session_start').length,
    2,
  );
  await assert.rejects(readFile(mcpLeak), { code: 'ENOENT' });
  await assert.rejects(
    readFile(join(native, 'npm/node_modules/qa-missing-never-install/package.json')),
    { code: 'ENOENT' },
  );
  await models.logout(request('one'));
  assert.equal((await models.status(request('one'))).status, 'not_ready');
  assert.equal((await models.status(request('two'))).status, 'ready');
  const broken = join(native, 'extensions/broken.js');
  await writeFile(broken, `export default function(){throw Error('BROKEN_EXTENSION')}`);
  await assert.rejects(models.catalog(), /Pi/);
  await rm(broken);
  const proof = {
    checkedAt: new Date().toISOString(),
    nativePi: pi.version,
    scope:
      'Actual native installed-extension discovery, production catalog/login/status/runtime and exact resume; owned extension modules and loopback SSE only',
    nativeAndLegacyProviderRegistrations: true,
    nativeProviderInCatalog: true,
    nativeObjectOAuthAndMetadata: true,
    twoAccountsIndependent: true,
    ambientKeyNotBorrowed: true,
    extensionStdoutDoesNotCorruptProtocol: true,
    mixedPackageSkillsAndPromptsExcluded: true,
    ambientSystemPromptExcluded: true,
    unassignedMcpNotStarted: true,
    missingPackagesNotInstalled: true,
    nativeDisabledAndProjectTrustRespected: true,
    extensionToolExecuted: true,
    studioControlAndCompletionPreserved: true,
    computerMcpNativeStatusToolExecuted: true,
    exactIdleResumeNoReplay: true,
    brokenExtensionFailsWithoutTruncatedFallback: true,
    explicitUserRequests: 1,
    localModelHttpRequests: httpRequests,
    externalModelRequests: 0,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/native-extensions-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  clearInterval(activityTimer);
  auth?.close();
  host?.close();
  await computer.drain();
  for (const child of children) if (child.process.exitCode === null) child.process.kill('SIGTERM');
  await Promise.allSettled(children.map((child) => child.exit));
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  await rm(root, { recursive: true, force: true });
}
