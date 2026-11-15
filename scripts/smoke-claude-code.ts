import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { modelAuthOperation } from '../src/main/pi/modelAuth.ts';
import { readPiCatalog } from '../src/main/pi/catalog.ts';
import { createConnectionServices } from '../bundled/pi-bridge/connection-runtime.mjs';
import './fixtures/deny-external.mjs';

// Actual pinned upstream provider + installed Pi SDK, owned CLI transport only.
// No user Claude configuration, credentials, model requests or billing checks.
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-claude-code-')));
const previous = { ...process.env };
const state = join(root, 'state.json'),
  log = join(root, 'cli.jsonl');
const scripts = new URL('../bundled/pi-bridge/', import.meta.url).pathname;
let session;
try {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${new URL('./fixtures/deny-external.mjs', import.meta.url).href}`;
  process.env.PI_CODING_AGENT_DIR = join(root, 'native');
  process.env.PI_CLAUDE_CODE_COMMAND = join(root, 'claude');
  process.env.PI_CLAUDE_CODE_CONFIG_DIR = join(root, 'claude-config');
  process.env.PI_STUDIO_QA_CLAUDE_STATE = state;
  process.env.PI_STUDIO_QA_CLAUDE_LOG = log;
  process.env.ANTHROPIC_API_KEY = 'QA_MUST_NOT_REACH_CLI';
  for (const key of [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS',
  ])
    delete process.env[key];
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  await cp(
    new URL('./fixtures/claude-cli.cjs', import.meta.url),
    process.env.PI_CLAUDE_CODE_COMMAND,
  );
  await writeFile(state, '{}');
  const pi = await checkPi('');
  assert.equal(pi.supported, true);
  const sdkPath = await resolvePiSdk(await realpath(pi.path));
  const sdk = await import(pathToFileURL(sdkPath).href);
  const status = () =>
    modelAuthOperation(pi.path, join(scripts, 'model-auth.mjs'), {
      action: 'status',
      provider: 'claude-code',
      cwd: root,
    });
  assert.equal((await status()).status, 'ready');
  const catalog = await readPiCatalog(pi.path, join(scripts, 'catalog.mjs'), root);
  const provider = catalog.providers.filter((item) => item.id === 'claude-code');
  assert.equal(provider.length, 1);
  assert.equal(provider[0].name, 'Claude Code — подписка');
  assert.equal(provider[0].isolatedAuth, false);
  assert.deepEqual(provider[0].loginMethods, []);
  assert.equal(provider[0].configured, true);
  assert.deepEqual(
    catalog.models.filter((item) => item.provider === 'claude-code').map((item) => item.id),
    ['claude-sonnet-5'],
  );
  assert.deepEqual(catalog.models.find((item) => item.provider === 'claude-code').reasoningLevels, [
    'low',
    'medium',
    'high',
  ]);
  const before = (await readFile(log, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(!before.some((item) => item.query === true), 'No catalog/status generation');

  const services = await createConnectionServices(sdk, undefined, root);
  const runtime = services.modelRuntime;
  await runtime.refresh({ allowNetwork: true, providers: ['claude-code'] });
  const model = runtime
    .getModels()
    .find((item) => item.provider === 'claude-code' && item.id === 'claude-sonnet-5');
  assert.ok(model, 'Models must come from the CLI discovery');
  session = await sdk.createAgentSessionFromServices({
    services,
    model,
    sessionManager: sdk.SessionManager.create(root, join(root, 'sessions')),
    tools: [],
  });
  await session.session.prompt('One fixture request.');
  const messages = session.session.messages;
  assert.ok(
    messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.content.some((block) => block.text === 'CLAUDE_FIXTURE_OK'),
    ),
  );
  const transcript = session.session.sessionManager.getSessionFile();
  assert.ok(transcript);
  const bytes = await readFile(transcript, 'utf8');
  session.session.dispose();
  session = undefined;

  await writeFile(state, JSON.stringify({ longTool: true }));
  let called = 0;
  const longName = 'mcp__user_specific_external_server__very_long_valid_tool_name';
  const toolServices = await createConnectionServices(sdk, undefined, root);
  const toolModel = toolServices.modelRuntime.getModel(model.provider, model.id);
  assert.ok(toolModel);
  session = await sdk.createAgentSessionFromServices({
    services: toolServices,
    model: toolModel,
    sessionManager: sdk.SessionManager.create(root, join(root, 'tool-sessions')),
    customTools: [
      {
        name: longName,
        label: 'Long MCP tool',
        description: 'QA long scoped tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          called++;
          return { content: [{ type: 'text', text: 'Long scoped tool executed.' }], details: {} };
        },
      },
    ],
  });
  await session.session.bindExtensions({});
  session.session.setActiveToolsByName([longName]);
  assert.ok(
    session.session.getActiveToolNames().includes(longName),
    JSON.stringify(session.session.getActiveToolNames()),
  );
  await session.session.prompt('Use the long scoped tool.');
  assert.equal(
    called,
    1,
    JSON.stringify(session.session.messages.filter((message) => message.role === 'assistant')),
  );
  assert.ok(
    session.session.messages.some(
      (message) => message.role === 'toolResult' && message.toolName === longName,
    ),
  );
  await session.session.prompt('Use it again with canonical history.');
  assert.equal(called, 2);
  session.session.dispose();
  session = undefined;
  await writeFile(state, '{}');

  const queryCount = async () =>
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((item) => item.query === true).length;
  const count = await queryCount();
  const resumedServices = await createConnectionServices(sdk, undefined, root);
  assert.ok(resumedServices.modelRuntime.getModel(model.provider, model.id));
  session = await sdk.createAgentSessionFromServices({
    services: resumedServices,
    model: resumedServices.modelRuntime.getModel(model.provider, model.id),
    sessionManager: sdk.SessionManager.open(transcript, join(root, 'sessions')),
    tools: [],
  });
  assert.equal(session.session.sessionManager.getSessionFile(), transcript);
  assert.equal(await readFile(transcript, 'utf8'), bytes);
  assert.equal(await queryCount(), count, 'Idle resume sends no message');
  session.session.dispose();
  session = undefined;

  for (const failure of [
    { error: 'Usage limit reached: subscription quota exhausted' },
    { overage: true },
  ]) {
    await writeFile(state, JSON.stringify(failure));
    const failedServices = await createConnectionServices(sdk, undefined, root);
    assert.ok(failedServices.modelRuntime.getModel(model.provider, model.id));
    session = await sdk.createAgentSessionFromServices({
      services: failedServices,
      model: failedServices.modelRuntime.getModel(model.provider, model.id),
      sessionManager: sdk.SessionManager.create(root, join(root, 'failures')),
      tools: [],
    });
    const admitted = await queryCount();
    await session.session.prompt('One explicit failure fixture, no fallback.');
    const reply = session.session.messages.filter((message) => message.role === 'assistant').at(-1);
    assert.equal(reply?.stopReason, 'error');
    assert.match(reply.errorMessage, failure.overage ? /charged|usage credits/i : /usage limit/i);
    assert.equal(await queryCount(), admitted + 1, 'No automatic fallback or paid retry');
    session.session.dispose();
    session = undefined;
  }

  for (const auth of [
    { loggedIn: false },
    { loggedIn: true, authMethod: 'api_key' },
    { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'unknown' },
  ]) {
    await writeFile(state, JSON.stringify({ auth }));
    assert.notEqual((await status()).status, 'ready');
  }
  await writeFile(state, JSON.stringify({ version: '1.0.0' }));
  assert.equal((await status()).status, 'invalid');
  await writeFile(state, '{}');
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1';
  assert.equal((await status()).status, 'invalid');
  delete process.env.ANTHROPIC_BASE_URL;
  process.env.PI_CLAUDE_CODE_COMMAND = join(root, 'missing');
  assert.equal((await status()).status, 'not_ready');
  assert.equal(
    await readFile(transcript, 'utf8'),
    bytes,
    'Checks do not rewrite the canonical dialogue',
  );
  await writeFile(
    new URL('../artifacts/claude-code-proof.json', import.meta.url),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        upstream: 'd5b5e04c314d3452d357174d16d10dda34daa2d2',
        pi: '1.5.2',
        nativeProvider: true,
        catalogSingleEntry: true,
        sharedCliAuth: true,
        cliModelDiscovery: true,
        fixtureModelRequest: true,
        canonicalPiTranscript: true,
        idleExactResumeNoReplay: true,
        quotaFailureNoFallback: true,
        longMcpToolNamesAndCanonicalHistory: true,
        overageDetectionStopsSubsequentRequestsOnly: true,
        noGenerationDuringChecks: true,
        noApiKeyInCli: true,
        missingCliAndWrongAuthAndVersionRejected: true,
        billingAcceptance: false,
        installedAcceptance: false,
        externalRequests: 0,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Claude Code: native provider/catalog/status/CLI transport/transcript passed. External requests: 0. Billing NOT verified.',
  );
} finally {
  session?.session.dispose();
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  await rm(root, { recursive: true, force: true });
}
