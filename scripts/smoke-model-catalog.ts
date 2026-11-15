import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { readPiCatalog } from '../src/main/pi/catalog.ts';
import type { ModelAuthScope } from '../src/main/pi/modelAuth.ts';

// Compare the whole native registry with the production subprocess/IPC result.
// No user configuration, credentials, auth servers or model requests are used.
const root = await mkdtemp(join(tmpdir(), 'pistudio-model-catalog-'));
const previous = { ...process.env };
try {
  const pi = await checkPi('');
  assert.equal(pi.supported, true);
  const sdkPath = await resolvePiSdk(await realpath(pi.path));
  process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
  process.env.PI_CLAUDE_CODE_COMMAND = join(root, 'no-user-claude');
  process.env.OPENAI_API_KEY = 'qa-ambient-not-a-real-key';
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  const attempts = join(root, 'network-attempts');
  const guard = join(root, 'deny-network.mjs');
  await writeFile(
    guard,
    `import {appendFileSync} from 'node:fs';
globalThis.fetch = async () => {
  appendFileSync(${JSON.stringify(attempts)}, 'fetch\\n');
  throw new Error('Catalog QA forbids network');
};\n`,
  );
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(guard).href}`;
  const sdk = await import(pathToFileURL(sdkPath).href);
  const runtime = await sdk.ModelRuntime.create({
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => {
        throw new Error('Read-only QA');
      },
      delete: async () => {
        throw new Error('Read-only QA');
      },
    },
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const nativeProviders = runtime.getProviders();
  const nativeModels = runtime.getModels();
  assert.ok(nativeProviders.length > 10, 'A truncated example registry is not sufficient');
  const scope: ModelAuthScope = {
    provider: 'studio-qa-catalog',
    authPath: join(root, 'scoped-auth.json'),
    endpoint: {
      url: 'http://127.0.0.1:1/v1',
      config: {
        api: 'openai-completions',
        auth: 'none',
        models: [
          {
            id: 'qa-local',
            name: 'QA local',
            imageInput: true,
            reasoning: true,
            contextWindow: 32768,
            maxTokens: 1024,
          },
        ],
      },
    },
  };
  const catalog = await readPiCatalog(
    pi.path,
    new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
    root,
    scope,
  );
  assert.deepEqual(
    catalog.providers
      .filter((p) => p.id !== scope.provider && p.id !== 'claude-code')
      .map((p) => p.id)
      .sort(),
    nativeProviders.map((p) => p.id).sort(),
  );
  assert.deepEqual(
    catalog.models
      .filter((m) => m.provider !== scope.provider && m.provider !== 'claude-code')
      .map((m) => `${m.provider}\0${m.id}`)
      .sort(),
    nativeModels.map((m) => `${m.provider}\0${m.id}`).sort(),
  );
  assert.equal(catalog.providers.filter((p) => p.id === 'claude-code').length, 1);
  assert.equal(catalog.providers.find((p) => p.id === 'claude-code')?.isolatedAuth, false);
  assert.deepEqual(
    catalog.models.filter((m) => m.provider === 'claude-code'),
    [],
  );
  for (const native of nativeProviders) {
    const provider = catalog.providers.find((p) => p.id === native.id)!;
    assert.equal(provider.name, native.name || native.id);
    assert.equal(provider.isolatedAuth, true);
    assert.equal(provider.configured, false, `${native.id}: no ambient or other account fallback`);
    assert.deepEqual(
      provider.loginMethods,
      [
        ...(native.auth.oauth
          ? [{ id: 'oauth', label: native.auth.oauth.loginLabel || native.auth.oauth.name }]
          : []),
        ...(native.auth.apiKey?.login ? [{ id: 'api_key', label: native.auth.apiKey.name }] : []),
      ],
      native.id,
    );
  }
  for (const native of nativeModels) {
    const model = catalog.models.find((m) => m.provider === native.provider && m.id === native.id)!;
    assert.equal(model.name, native.name || native.id);
    assert.equal(model.api, native.api);
    assert.equal(model.reasoning, native.reasoning === true);
    assert.equal(model.imageInput, native.input?.includes('image') === true);
    assert.ok(model.reasoningLevels?.length);
    assert.ok(model.reasoningLevels.includes(model.defaultReasoningLevel!));
  }
  assert.equal(catalog.models.filter((m) => m.provider === scope.provider).length, 1);
  assert.equal(catalog.providers.find((p) => p.id === scope.provider)?.configured, true);
  assert.equal(catalog.models.find((m) => m.provider === scope.provider)?.id, 'qa-local');
  const selectedCodex = await readPiCatalog(
    pi.path,
    new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
    root,
    { provider: 'openai-codex', authPath: join(root, 'codex-auth.json') },
  );
  assert.equal(selectedCodex.providers.length, nativeProviders.length + 1);
  assert.deepEqual(
    selectedCodex.providers
      .filter((p) => p.id !== 'claude-code')
      .map((p) => [p.id, p.loginMethods]),
    catalog.providers
      .filter((p) => p.id !== scope.provider && p.id !== 'claude-code')
      .map((p) => [p.id, p.loginMethods]),
  );
  assert.ok(selectedCodex.providers.every((p) => !p.configured));
  assert.deepEqual(
    selectedCodex.models,
    catalog.models.filter((m) => m.provider !== scope.provider && m.provider !== 'claude-code'),
  );
  await assert.rejects(readFile(attempts), { code: 'ENOENT' });
  console.log(
    JSON.stringify(
      {
        nativePi: '1.5.2',
        providers: nativeProviders.length,
        models: nativeModels.length,
        oauthProviders: nativeProviders.filter((p) => p.auth.oauth).map((p) => p.id),
        apiKeyProviders: nativeProviders.filter((p) => p.auth.apiKey?.login).length,
        productionScopedCatalogExact: true,
        selectedCodexAndEndpointMethodsExact: true,
        customEndpointPreserved: true,
        ambientAuthSuppressed: true,
        fetchAttempts: 0,
        boundaries:
          'Native builtins and explicit endpoint; installed provider-extension discovery is not proven.',
      },
      null,
      2,
    ),
  );
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  await rm(root, { recursive: true, force: true });
}
