import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { ModelConnections } from '../src/main/pi/ModelConnections.ts';
import { BrowserAuth, resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { connectionAuthScope } from '../src/main/pi/modelAuth.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { createLibraryRunHost } from '../src/main/pi/createLibraryRunHost.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { snapshotAgent } from '../src/main/storage/validation.ts';

// Real native login/store/runtime, synthetic credentials only; no request to an LLM or auth server.
const root = await mkdtemp(join(tmpdir(), 'pistudio-isolated-models-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
assert.equal(pi.supported, true);
const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
const { createConnectionRuntime } = await import('../bundled/pi-bridge/connection-runtime.mjs');
const scripts = new URL('../bundled/pi-bridge/', import.meta.url).pathname;
const auth = new BrowserAuth(join(scripts, 'login.mjs'), async () => {
  throw new Error('This API-key test must not open a browser.');
});
const connections = new ModelConnections(
  service,
  join(root, 'model-auth'),
  scripts,
  () => pi.path,
  auth,
);
const profiles: Connection[] = ['one', 'two'].map((id) => ({
  id,
  name: id,
  providerId: 'openai',
  purpose: 'pi',
  authScope: 'connection',
  endpoint: '',
  account: '',
  createdAt: 1,
}));
const request = (id: string) => ({ folder: store.folder, connectionId: id });
const keys = ['sk-studio-fixture-one-not-a-real-key', 'sk-studio-fixture-two-not-a-real-key'];
const until = async <T>(read: () => Promise<T> | T, match: (value: T) => boolean) => {
  for (let i = 0; i < 300; i++) {
    const value = await read();
    if (match(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for native connection state.');
};
async function login(id: string, key: string) {
  const state = await connections.login({ ...request(id), method: 'api_key' });
  const prompt = await until(
    () => auth.read(state.id),
    (value) => !!value.prompt || value.phase === 'error',
  );
  assert.equal(prompt.phase, 'waiting');
  assert.equal(prompt.prompt!.secret, true);
  auth.answer(state.id, prompt.prompt!.id, key);
  const done = await until(
    () => auth.read(state.id),
    (value) => ['ready', 'error'].includes(value.phase),
  );
  assert.equal(done.phase, 'ready');
}
async function verifyProductionResumes() {
  const model = {
    connectionId: 'two',
    provider: 'openai',
    id: 'gpt-4.1',
    reasoning: 'По умолчанию',
    temperature: '',
  };
  const profile: Agent = {
    id: 'qa-scoped-agent',
    name: 'Scoped agent',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction: 'QA_CURRENT_ONLY',
    model,
  };
  await store.saveSection('agents', [profile]);
  const project = (
    await store.command({ kind: 'create', name: 'Scoped project', agents: [profile] })
  ).projects[0];
  const projectRoot = await store.projects.directory(project.id);
  async function seed(rootPath: string, outputPath: string) {
    const cwd = join(rootPath, dirname(outputPath));
    await mkdir(join(cwd, 'sessions'), { recursive: true });
    await mkdir(join(cwd, 'output'), { recursive: true });
    const manager = sdk.SessionManager.create(cwd, join(cwd, 'sessions'));
    manager.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'Seeded QA history; wait for explicit new input.' }],
      timestamp: 1,
    });
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Seeded reply.' }],
      api: 'openai-responses',
      provider: 'openai',
      model: model.id,
      stopReason: 'stop',
      timestamp: 2,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    return {
      id: manager.getSessionId(),
      path: relative(rootPath, manager.getSessionFile()),
      title: 'QA history',
      createdAt: 1,
    };
  }
  const session = await seed(projectRoot, project.agents[0].outputPath);
  await store.projects.updateRuntime(project.id, profile.id, 'stopped', session);
  const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
  const helper = {
    ...systems.find((item) => item.systemRole === 'assistant')!,
    model,
    mainInstruction: 'QA_CURRENT_ONLY',
  };
  await store.saveSection(
    'systemAgents',
    systems.map((item) => (item.id === helper.id ? helper : item)),
  );
  const helperRoot = join(store.folder, '.pistudio/setup-assistant');
  const helperOutput = snapshotAgent(helper).outputPath;
  const helperSession = await seed(helperRoot, helperOutput);
  await writeFile(
    join(helperRoot, 'state.json'),
    JSON.stringify({ schemaVersion: 1, session: helperSession, outputPath: helperOutput }),
  );
  const children: Promise<number | null>[] = [];
  const guard = join(root, 'network-guard.mjs'),
    proof = join(root, 'request-proof.json');
  await writeFile(
    guard,
    `import {writeFileSync} from 'node:fs';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return nativeFetch(input,init);
 const headers=new Headers(init?.headers??input?.headers);
 writeFileSync(${JSON.stringify(proof)},JSON.stringify({accountMatches:headers.get('authorization')===${JSON.stringify('Bearer ' + keys[1])},model:JSON.parse(init?.body??'{}').model}));
 return new Response(JSON.stringify({error:{message:'QA denies all external model requests',type:'invalid_request_error',code:'qa_denied'}}),{status:400,headers:{'content-type':'application/json'}});
};`,
  );
  const options = {
    bootstraps: join(root, 'boots'),
    bridge: join(scripts, 'session.mjs'),
    catalog: join(scripts, 'catalog.mjs'),
    piPath: () => pi.path,
    headless: true,
    openTerminal: async (node: string, bridge: string, bootstrap: string) => {
      const child = spawn(node, ['--import', guard, bridge, bootstrap], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      });
      child.stderr.resume();
      children.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
  };
  const host = createStudioRunHost(service, options);
  const assistant = createSetupAssistant(service, options);
  const library = createLibraryRunHost(service, { ...options, references: new ReferenceFiles() });
  try {
    for (const [activeHost, req, base, bound] of [
      [
        host,
        { projectId: project.id, agentId: profile.id, autoContinue: false },
        projectRoot,
        session,
      ],
      [
        assistant,
        { projectId: 'pi-setup-assistant', agentId: helper.id, autoContinue: false },
        helperRoot,
        helperSession,
      ],
    ] as const) {
      const before = await readFile(join(base, bound.path), 'utf8');
      const result = await activeHost.launch(req);
      assert.equal(await children.at(-1), 0, 'Production scoped bridge must open and close idle');
      const after = await readFile(join(base, bound.path), 'utf8');
      const messages = (text: string) =>
        text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((item) => item.type === 'message');
      assert.deepEqual(
        messages(after),
        messages(before),
        'Idle resume sends no request and reuses exact history',
      );
      const context = await readFile(
        join(base, '.pistudio/context', result.runId, 'context.json'),
        'utf8',
      );
      assert.equal(JSON.parse(context).model.connectionId, 'two');
      for (const key of keys) {
        assert.equal(context.includes(key), false);
        assert.equal(after.includes(key), false);
      }
      assert.equal(context.includes('model-auth'), false);
      assert.equal(context.includes('QA_CURRENT_ONLY'), false);
    }
    assert.equal((await store.projects.read(project.id)).agents[0].session?.path, session.path);
    assert.equal(
      JSON.parse(await readFile(join(helperRoot, 'state.json'), 'utf8')).session.path,
      helperSession.path,
    );
    await assert.rejects(() => stat(proof), { code: 'ENOENT' });
    await store.saveSection(
      'systemAgents',
      (store.bootstrap().sections.systemAgents as SystemAgent[]).map((item) =>
        item.systemRole === 'character' ? { ...item, model } : item,
      ),
    );
    const libraryRun = await library.create({
      kind: 'characters',
      description: 'QA: do not generate externally.',
      attachments: [],
    });
    assert.equal(await children.at(-1), 0, 'Pi settles the deliberately denied model request');
    const attempted = JSON.parse(await readFile(proof, 'utf8'));
    assert.equal(
      attempted.accountMatches,
      true,
      'Production library model resolves the selected isolated account',
    );
    assert.equal(attempted.model, model.id);
    const libraryState = JSON.parse(
      await readFile(
        join(store.folder, '.pistudio/library-runs', libraryRun.project.id, 'state.json'),
        'utf8',
      ),
    );
    assert.equal(libraryState.project.agents[0].runStatus, 'error');
    console.log(
      'Production scoped project/helper exact idle resumes passed; existing messages unchanged, no credential paths/keys/instruction copies in context.',
    );
  } finally {
    host.close();
    assistant.close();
    library.close();
    await Promise.allSettled(children);
  }
}
try {
  await store.saveSection('connections', profiles);
  for (const profile of profiles)
    assert.equal((await connections.status(request(profile.id))).status, 'not_ready');
  await login('one', keys[0]);
  assert.equal((await connections.status(request('one'))).status, 'ready');
  assert.equal((await connections.status(request('two'))).status, 'not_ready');
  await login('two', keys[1]);
  const scopes = await Promise.all(
    profiles.map((profile) => connectionAuthScope(join(root, 'model-auth'), store.folder, profile)),
  );
  assert.notEqual(scopes[0]!.authPath, scopes[1]!.authPath);
  for (let i = 0; i < 2; i++) {
    const runtime = await createConnectionRuntime(sdk, scopes[i]);
    assert.equal((await runtime.getAuth('openai'))?.auth.apiKey, keys[i]);
    assert.equal((await stat(scopes[i]!.authPath)).mode & 0o777, 0o600);
  }
  assert.equal((await stat(join(root, 'model-auth'))).mode & 0o777, 0o700);
  await connections.logout(request('one'));
  assert.equal((await connections.status(request('one'))).status, 'not_ready');
  assert.equal((await connections.status(request('two'))).status, 'ready');
  await login('one', keys[1]);
  assert.equal(
    (await (await createConnectionRuntime(sdk, scopes[0])).getAuth('openai'))?.auth.apiKey,
    keys[1],
  );
  await verifyProductionResumes();
  const cancelled = await connections.login({ ...request('one'), method: 'api_key' });
  await until(
    () => auth.read(cancelled.id),
    (value) => !!value.prompt,
  );
  auth.cancel(cancelled.id);
  assert.equal(auth.read(cancelled.id).phase, 'cancelled');
  assert.equal((await connections.status(request('one'))).status, 'ready');
  // A late verification failure must never replace an explicit cancellation.
  let rejectVerification: (reason: Error) => void = () => {};
  const verification = new Promise<boolean>((_resolve, reject) => {
    rejectVerification = reject;
  });
  const verifying = await auth.startProvider(pi.path, {
    provider: 'openai',
    method: 'api_key',
    scope: scopes[0],
    key: 'qa-verifying-cancel',
    verify: () => verification,
  });
  const verificationPrompt = await until(
    () => auth.read(verifying.id),
    (value) => !!value.prompt,
  );
  auth.answer(verifying.id, verificationPrompt.prompt!.id, keys[0]);
  await until(
    () => auth.read(verifying.id),
    (value) => value.phase === 'verifying',
  );
  auth.cancel(verifying.id);
  rejectVerification(new Error('Late fixture verification failure'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(auth.read(verifying.id).phase, 'cancelled');
  await mkdir(join(root, 'OtherStudio'));
  assert.notEqual(
    (await connectionAuthScope(join(root, 'model-auth'), join(root, 'OtherStudio'), profiles[0]))!
      .authPath,
    scopes[0]!.authPath,
  );
  await assert.rejects(
    () => connections.status({ ...request('one'), folder: join(root, 'OtherStudio') }),
    /Папка студии/,
  );
  await assert.rejects(() => connections.status(request('missing')), /отсутствует/);
  const ambient = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    const nativeDir = join(root, 'native-agent');
    await mkdir(nativeDir);
    await writeFile(
      join(nativeDir, 'models.json'),
      JSON.stringify({
        providers: {
          openai: {
            baseUrl: 'http://127.0.0.1:1/v1',
            apiKey: keys[0],
            api: 'openai-completions',
            models: [
              {
                id: 'qa-global-only',
                name: 'Global fixture',
                reasoning: false,
                input: ['text'],
                contextWindow: 4096,
                maxTokens: 1024,
              },
            ],
          },
        },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = nativeDir;
    const native = await sdk.ModelRuntime.create({
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    assert.ok(native.getModel('openai', 'qa-global-only'));
    const scopedCatalog = await connections.catalog(request('two'));
    assert.equal(
      scopedCatalog.models.some((model) => model.id === 'qa-global-only'),
      false,
      'Agent selector uses the same scoped catalog as launch',
    );
    assert.ok(
      scopedCatalog.models.some((model) => model.provider === 'openai' && model.id === 'gpt-4.1'),
    );
    process.env.OPENAI_API_KEY = 'sk-ambient-fixture';
    process.env.ANTHROPIC_API_KEY = 'sk-other-provider-fixture';
    await connections.logout(request('one'));
    const runtime = await createConnectionRuntime(sdk, scopes[0]);
    assert.equal(
      await runtime.getAuth('openai'),
      undefined,
      'No ambient fallback for selected account',
    );
    assert.equal(
      await runtime.getAuth('anthropic'),
      undefined,
      'No ambient fallback for another provider',
    );
    await writeFile(
      scopes[0]!.authPath,
      JSON.stringify({ anthropic: { type: 'api_key', key: keys[0] } }),
      { mode: 0o600 },
    );
    const foreign = await createConnectionRuntime(sdk, scopes[0]);
    assert.equal(
      await foreign.getAuth('anthropic'),
      undefined,
      'Other provider credentials are not usable',
    );
  } finally {
    if (ambient === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ambient;
    if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anthropic;
    if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = agentDir;
  }
  const studio = await readFile(join(store.folder, '.pistudio/studio.json'), 'utf8');
  for (const key of keys) assert.equal(studio.includes(key), false);
  assert.equal(
    (await readdir(join(root, 'model-auth'))).some((name) => name.endsWith('.lock')),
    false,
  );
  console.log(
    'Native model connections passed: two accounts, masked login/replace/cancel/logout, persisted independent native stores, studio scope, permissions, no ambient/other-provider fallback, no keys in studio. No model requests.',
  );
} finally {
  auth.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
