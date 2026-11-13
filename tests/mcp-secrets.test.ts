import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretVault, type StringProtector } from '../src/main/storage/SecretVault.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { McpSecrets } from '../src/main/pi/McpSecrets.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { resolveResources } from '../src/main/pi/resources.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { PiConfigValues } from '../src/main/pi/mcpSecretValues.ts';

// Storage tests substitute the native parser seam; the opt-in SDK/HTTP/stdio test uses Pi's actual parser and transports.
const parser: PiConfigValues = {
  getConfigValueEnvVarNames: (value) =>
    value.startsWith('!')
      ? []
      : [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]),
  isCommandConfigValue: (value) => value.startsWith('!'),
  resolveConfigValue: (value, env) => {
    let missing = false;
    const result = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const resolved = env[name] || process.env[name];
      if (!resolved) missing = true;
      return resolved ?? '';
    });
    return missing ? undefined : result;
  },
};
const resource: Resource = {
  id: 'protected',
  kind: 'mcps',
  name: 'Protected',
  source: 'pi:protected',
  description: '',
  transport: 'HTTP',
  version: '',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
const agent: Agent = {
  id: 'agent',
  name: 'Agent',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: ['protected'],
  plugins: [],
  model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'Низкий', temperature: '' },
};
function protection() {
  const key = randomBytes(32);
  let available = true;
  const protector: StringProtector = {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (text) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        body = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptStringAsync: async (bytes) => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return {
        result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
        shouldReEncrypt: false,
      };
    },
  };
  return {
    protector,
    disable: () => {
      available = false;
    },
  };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-mcp-secrets-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
  await mkdir(process.env.PI_CODING_AGENT_DIR);
  const configFile = join(process.env.PI_CODING_AGENT_DIR, 'mcp.json');
  const config = {
    url: 'https://service.example/mcp',
    headers: { Authorization: 'Bearer ${TOKEN}' },
  };
  const writeConfig = (value: object) =>
    writeFile(configFile, JSON.stringify({ mcpServers: { protected: value } }));
  await writeConfig(config);
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  await store.saveSection('resources', [resource]);
  const crypto = protection(),
    directory = join(root, 'Secrets'),
    vault = new SecretVault(directory, crypto.protector);
  const secrets = new McpSecrets(
    service,
    vault,
    () => '',
    async () => parser,
  );
  const request = { folder: store.folder, resourceId: resource.id };
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const current = () => (store.bootstrap().sections.resources as Resource[])[0];
  return {
    root,
    service,
    store,
    vault,
    secrets,
    request,
    config,
    configFile,
    writeConfig,
    crypto,
    directory,
    current,
  };
}

test('MCP keys are encrypted, scoped and delivered only to assigned enabled resources without project copies', async (t) => {
  const f = await fixture(t),
    key = 'SYNTHETIC_MCP_KEY';
  const before = await f.secrets.status(f.request);
  assert.deepEqual(before.fields, [{ name: 'TOKEN', stored: false }]);
  const saved = await f.secrets.save({
    ...f.request,
    revision: before.revision,
    values: { TOKEN: key },
  });
  assert.equal(saved.managed, true);
  assert.equal(saved.fields[0].stored, true);
  assert.equal(JSON.stringify(saved).includes(key), false);
  const files = await readdir(f.directory);
  assert.equal(files.length, 1);
  assert.equal((await readFile(join(f.directory, files[0]), 'utf8')).includes(key), false);
  assert.equal((await readFile(f.configFile, 'utf8')).includes(key), false);
  await assert.rejects(resolveResources(agent, [f.current()]), /недоступны/);
  const created = await f.store.command({ kind: 'create', name: 'Project', agents: [agent] });
  const project = created.projects[0],
    root = await f.store.projects.directory(project.id);
  const run = await buildRunContext(
    root,
    project,
    agent.id,
    [agent],
    [f.current()],
    f.secrets.resolver(f.store.folder, ''),
  );
  assert.deepEqual(run.resources.mcpServers[0].config.headers, { Authorization: 'Bearer ' + key });
  assert.equal(
    (
      await readFile(join(root, '.pistudio/context', run.record.runId, 'context.json'), 'utf8')
    ).includes(key),
    false,
  );
  assert.equal((await readFile(join(root, 'project.json'), 'utf8')).includes(key), false);
  const disabled = { ...agent, capabilitySettings: { 'mcps:protected': { enabled: false } } };
  assert.deepEqual(
    (await resolveResources(disabled, [f.current()], f.secrets.resolver(f.store.folder, '')))
      .mcpServers,
    [],
  );
  await assert.rejects(f.secrets.status({ ...f.request, resourceId: 'other' }), /настройте/i);
  await assert.rejects(
    f.secrets.status({ ...f.request, folder: join(f.root, 'Other') }),
    /изменилась/,
  );
  const other = await f.service.open(join(f.root, 'Other'));
  const otherStore = await f.service.load();
  await otherStore.saveSection('resources', [f.current()]);
  assert.equal(
    (await f.secrets.status({ folder: other.folder, resourceId: resource.id })).fields[0].stored,
    false,
  );
});

test('configuration changes never send an old key to a new endpoint; stale saves, deletion and unavailable crypto fail closed', async (t) => {
  const f = await fixture(t),
    old = await f.secrets.status(f.request);
  await f.secrets.save({
    ...f.request,
    revision: old.revision,
    values: { TOKEN: 'SYNTHETIC_OLD' },
  });
  await f.writeConfig({ ...f.config, url: 'https://different.example/mcp' });
  const changed = await f.secrets.status(f.request);
  assert.equal(changed.configurationChanged, true);
  assert.equal(changed.fields[0].stored, false);
  await assert.rejects(
    f.secrets.save({ ...f.request, revision: old.revision, values: { TOKEN: 'MUST_NOT_SAVE' } }),
    /изменилась/,
  );
  await assert.rejects(
    f.secrets.resolver(f.store.folder, '')(f.current(), {
      ...f.config,
      url: 'https://different.example/mcp',
    }),
    /изменён/,
  );
  await f.secrets.save({
    ...f.request,
    revision: changed.revision,
    values: { TOKEN: 'SYNTHETIC_NEW' },
  });
  const native = new StudioResources(f.service, {
    piPath: () => '',
    script: 'unused',
    mcpSecrets: f.secrets,
    operation: async (_pi, _script, request) => ({ name: request.name, transport: 'HTTP' }),
  });
  await native.importMcp(f.store.folder, 'protected', undefined, {
    name: 'protected',
    transport: 'HTTP',
  });
  assert.equal(
    f.current().credential,
    'keychain:pistudio-mcp',
    'Reimport preserves secure management mode',
  );
  await f.secrets.remove({ ...f.request, revision: changed.revision });
  assert.equal((await f.secrets.status(f.request)).hasSavedValues, false);
  assert.equal(
    f.current().credential,
    'keychain:pistudio-mcp',
    'Deleting credentials must never silently fall back to a global account',
  );
  await assert.rejects(
    f.secrets.resolver(f.store.folder, '')(f.current(), {
      ...f.config,
      url: 'https://different.example/mcp',
    }),
    /не удалось прочитать/i,
  );
  f.crypto.disable();
  await assert.rejects(
    f.secrets.save({
      ...f.request,
      revision: changed.revision,
      values: { TOKEN: 'MUST_NOT_SAVE' },
    }),
    /хранилище/,
  );
  for (const values of [{ UNKNOWN: 'x' }, { TOKEN: 'bad\nheader' }, { TOKEN: '   ' }])
    await assert.rejects(f.secrets.save({ ...f.request, revision: changed.revision, values }));
});

test('an in-flight native MCP check cannot publish readiness after the protected key is replaced', async (t) => {
  const f = await fixture(t),
    state = await f.secrets.status(f.request);
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_FIRST' },
  });
  let started = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const native = new StudioResources(f.service, {
    piPath: () => '',
    script: 'unused',
    mcpSecrets: f.secrets,
    operation: async (_pi, _script, request) => {
      assert.deepEqual(request.config?.headers, { Authorization: 'Bearer SYNTHETIC_FIRST' });
      started = true;
      await gate;
      return { status: 'available', toolCount: 1 };
    },
  });
  const checking = native.check(resource.id);
  void checking.catch(() => {});
  while (!started) await new Promise((resolve) => setTimeout(resolve, 10));
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_REPLACEMENT' },
  });
  release();
  await assert.rejects(checking, /изменились/);
  assert.equal(f.current().check, undefined);
});

test('only saved variables are managed; native environment remains native and deleted secrets never fall back', async (t) => {
  const f = await fixture(t);
  const beforeEnv = { region: process.env.QA_MCP_REGION, token: process.env.TOKEN };
  process.env.QA_MCP_REGION = 'qa-region';
  process.env.TOKEN = 'SYNTHETIC_GLOBAL_MUST_NOT_REPLACE_DELETED';
  t.after(() => {
    if (beforeEnv.region === undefined) delete process.env.QA_MCP_REGION;
    else process.env.QA_MCP_REGION = beforeEnv.region;
    if (beforeEnv.token === undefined) delete process.env.TOKEN;
    else process.env.TOKEN = beforeEnv.token;
  });
  const config = {
    ...f.config,
    env: { PATH: '${PATH}', HOME: '${HOME}', REGION: '${QA_MCP_REGION}' },
    headers: { Authorization: 'Bearer ${TOKEN}', Mixed: '${TOKEN}/${QA_MCP_REGION}' },
  };
  await f.writeConfig(config);
  const state = await f.secrets.status(f.request);
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_PRIVATE' },
  });
  assert.deepEqual(f.current().mcpSecretNames, ['TOKEN']);
  const resolved = await f.secrets.resolver(f.store.folder, '')(f.current(), config);
  assert.deepEqual(resolved.env, config.env, 'Unmanaged env fields reach native Pi unchanged');
  assert.deepEqual(resolved.headers, {
    Authorization: 'Bearer SYNTHETIC_PRIVATE',
    Mixed: 'SYNTHETIC_PRIVATE/qa-region',
  });
  await f.secrets.remove({ ...f.request, revision: state.revision });
  assert.deepEqual(f.current().mcpSecretNames, ['TOKEN']);
  await assert.rejects(
    f.secrets.resolver(f.store.folder, '')(f.current(), config),
    /не удалось прочитать/i,
  );
  await assert.rejects(
    f.secrets.save({
      ...f.request,
      revision: state.revision,
      values: { QA_MCP_REGION: 'new-region' },
    }),
    /ранее сохранённые/,
  );
  assert.equal((await f.secrets.status(f.request)).hasSavedValues, false);
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_NEW_PRIVATE' },
  });
  assert.deepEqual(f.current().mcpSecretNames, ['TOKEN']);
  assert.deepEqual(
    (await f.secrets.resolver(f.store.folder, '')(f.current(), config)).env,
    config.env,
  );
  const native = new StudioResources(f.service, {
    piPath: () => '',
    script: 'unused',
    mcpSecrets: f.secrets,
    operation: async () => ({ name: 'protected', transport: 'HTTP' }),
  });
  await native.importMcp(f.store.folder, 'protected', undefined, {
    name: 'protected',
    transport: 'HTTP',
  });
  assert.deepEqual(
    f.current().mcpSecretNames,
    ['TOKEN'],
    'Reimport retains ownership after deletion/re-entry',
  );
});

test('changed endpoints require every previously managed current variable, without promoting ordinary env to secrets', async (t) => {
  const f = await fixture(t);
  const config = { ...f.config, env: { PRIVATE: '${SECOND_TOKEN}', HOME: '${HOME}' } };
  await f.writeConfig(config);
  let state = await f.secrets.status(f.request);
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_FIRST', SECOND_TOKEN: 'SYNTHETIC_SECOND' },
  });
  await f.writeConfig({ ...config, url: 'https://new.example/mcp' });
  state = await f.secrets.status(f.request);
  await assert.rejects(
    f.secrets.save({
      ...f.request,
      revision: state.revision,
      values: { TOKEN: 'SYNTHETIC_NEW_FIRST' },
    }),
    /ранее сохранённые/,
  );
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { TOKEN: 'SYNTHETIC_NEW_FIRST', SECOND_TOKEN: 'SYNTHETIC_NEW_SECOND' },
  });
  assert.deepEqual(f.current().mcpSecretNames, ['TOKEN', 'SECOND_TOKEN']);
  assert.equal(
    (await f.secrets.status(f.request)).fields.find((field) => field.name === 'HOME')?.stored,
    false,
  );
});
test('registered OAuth client secrets use the same protected storage and native literal escaping', async (t) => {
  const f = await fixture(t);
  const config = {
    url: 'https://service.example/mcp',
    oauth: { clientId: 'public-id', clientSecret: '${CLIENT_SECRET}', scope: 'qa:read' },
  };
  await f.writeConfig(config);
  const state = await f.secrets.status(f.request);
  assert.deepEqual(state.fields, [{ name: 'CLIENT_SECRET', stored: false }]);
  await f.secrets.save({
    ...f.request,
    revision: state.revision,
    values: { CLIENT_SECRET: '!SYNTHETIC_${HOME}' },
  });
  const prepared = await f.secrets.resolver(f.store.folder, '')(f.current(), config);
  assert.deepEqual(prepared.oauth, {
    clientId: 'public-id',
    clientSecret: '$!SYNTHETIC_$${HOME}',
    scope: 'qa:read',
  });
  assert.ok(!JSON.stringify(f.store.bootstrap()).includes('!SYNTHETIC_'));
});
