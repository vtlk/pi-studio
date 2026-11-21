import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { BrowserAuth } from '../src/main/pi/BrowserAuth.ts';
import { McpSecrets } from '../src/main/pi/McpSecrets.ts';
import { SecretVault } from '../src/main/storage/SecretVault.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { oauthMcpFixture } from './fixtures/oauth-mcp.mjs';
import { verifyOAuthResume } from './fixtures/oauth-session.ts';
import type { Resource } from '../src/shared/resources.ts';
import { exportTeam } from '../src/main/teams/exportTeam.ts';
import { importTeam } from '../src/main/teams/importTeam.ts';
import { encodePackage } from '../src/main/teams/packageCodec.ts';
import { readImport } from '../src/main/teams/importState.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-native-oauth-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
// Presentation/auth checks can run without the separate project-session resume scenario.
const authOnly = process.argv.includes('--auth-only');
process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
await mkdir(process.env.PI_CODING_AGENT_DIR);
const fixture = await oauthMcpFixture();
let mode = 'wait',
  browsers = 0;
const browser = new BrowserAuth(resolve('bundled/pi-bridge/login.mjs'), async (url) => {
  browsers++;
  if (mode === 'authorize') await fixture.authorize(url);
});
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio')),
  store = await service.load();
const resource: Resource = {
  id: 'oauth',
  name: 'QA OAuth',
  kind: 'mcps',
  source: 'pi:qa_oauth',
  transport: 'HTTP',
  version: '',
  description: 'QA only',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
const pi = await checkPi('');
const key = randomBytes(32);
const vault = new SecretVault(join(root, 'Secrets'), {
  isAsyncEncryptionAvailable: async () => true,
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
});
const secrets = new McpSecrets(service, vault, () => pi.path);
const resources = new StudioResources(service, {
  script: resolve('bundled/pi-bridge/resources.mjs'),
  piPath: () => pi.path,
  mcpSecrets: secrets,
  browserAuth: browser,
});
const config = {
  url: fixture.url,
  oauth: {
    clientId: 'qa-private-client',
    clientSecret: '${CLIENT_SECRET}',
    scope: 'qa:read',
    clientRegistration: 'dcr',
  },
};
await writeFile(
  join(process.env.PI_CODING_AGENT_DIR, 'mcp.json'),
  JSON.stringify({ mcpServers: { qa_oauth: config } }),
);
await store.saveSection('resources', [resource]);
const request = { folder: store.folder, resourceId: resource.id };
async function stateUntil(id: string, check: (phase: string) => boolean) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const state = browser.read(id);
    assert.ok(!JSON.stringify(state).includes(fixture.secret));
    if (check(state.phase)) return state;
    if (state.phase === 'error') throw new Error(state.message);
    if (Date.now() > deadline) throw new Error('OAuth phase timeout: ' + state.phase);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  const status = await secrets.status(request);
  assert.ok(status.fields.some((field) => field.name === 'CLIENT_SECRET'));
  await secrets.save({
    ...request,
    revision: status.revision,
    values: { CLIENT_SECRET: fixture.secret },
  });
  assert.equal((await resources.check(resource.id)).status, 'needs_auth');
  assert.equal(browsers, 0, 'Checks must not open consent automatically');
  const cancelled = await resources.login(resource.id);
  assert.ok(cancelled.loginId);
  await stateUntil(cancelled.loginId!, (phase) => phase === 'waiting');
  browser.cancel(cancelled.loginId!);
  assert.equal(browser.read(cancelled.loginId!).phase, 'cancelled');
  assert.equal(fixture.state.authorized, 0);
  mode = 'authorize';
  const login = await resources.login(resource.id);
  assert.ok(login.loginId);
  assert.equal((await stateUntil(login.loginId!, (phase) => phase === 'ready')).phase, 'ready');
  assert.equal(fixture.state.clientSecretReceived, true);
  assert.equal(fixture.state.authorized, 1);
  assert.equal((await resources.check(resource.id)).status, 'available');
  const native = await readFile(join(process.env.PI_CODING_AGENT_DIR, 'mcp-auth.json'), 'utf8');
  assert.ok(
    !native.includes(fixture.secret),
    'Configured client secret is never duplicated in native token storage',
  );
  assert.ok(!JSON.stringify(store.bootstrap()).includes(fixture.secret));
  const initialBrowsers = browsers;
  fixture.requireScope('qa:write');
  assert.equal((await resources.check(resource.id)).status, 'needs_auth');
  assert.equal(browsers, initialBrowsers, 'A new scope never opens consent automatically');
  const expanded = await resources.login(resource.id);
  await stateUntil(expanded.loginId!, (phase) => phase === 'ready');
  assert.ok(fixture.state.grantedScope.split(' ').includes('qa:write'));
  const count = browsers;
  fixture.expireAccess();
  assert.equal((await resources.check(resource.id)).status, 'available');
  assert.ok(fixture.state.refreshed >= 1);
  assert.equal(browsers, count);
  if (!authOnly) await verifyOAuthResume(service, secrets, resource, pi.path, root, fixture);
  assert.equal(browsers, count, 'Opening a bound dialogue never opens consent automatically');
  fixture.revoke();
  assert.equal((await resources.check(resource.id)).status, 'needs_auth');
  assert.equal(browsers, count);
  const dynamic = {
    url: fixture.url,
    oauth: { clientRegistration: 'dcr', scope: 'qa:read qa:write' },
  };
  await writeFile(
    join(process.env.PI_CODING_AGENT_DIR, 'mcp.json'),
    JSON.stringify({ mcpServers: { qa_oauth: dynamic } }),
  );
  const registered = await resources.login(resource.id);
  await stateUntil(registered.loginId!, (phase) => phase === 'ready');
  assert.ok(
    fixture.state.registrations >= 1,
    'The native SDK performs dynamic client registration',
  );
  assert.equal(browsers, count + 1);
  const packet = await exportTeam(
    {
      agents: [
        {
          id: 'qa-role',
          name: 'QA role',
          enabled: true,
          instructions: [],
          skills: [],
          mcps: [resource.id],
          plugins: [],
        },
      ],
      teams: [
        {
          id: 'qa-team',
          name: 'QA imported OAuth team',
          agentIds: ['qa-role'],
          workspaceMode: 'shared',
        },
      ],
    },
    'qa-team',
    [resource],
    [],
    async () => dynamic,
  );
  const imported = await importTeam(store, encodePackage(packet));
  const importedMcp = Object.values((await readImport(store, imported.id)).state.resourceMap).find(
    (id) => id !== 'pistudio-project',
  )!;
  const nativeFile = join(process.env.PI_CODING_AGENT_DIR, 'mcp.json');
  await rm(nativeFile);
  const fromPackage = await resources.login(importedMcp, store.folder);
  assert.ok(fromPackage.loginId);
  await stateUntil(fromPackage.loginId!, (phase) => phase === 'ready');
  assert.equal((await resources.check(importedMcp, store.folder)).status, 'available');
  assert.ok((await readFile(nativeFile, 'utf8')).includes('studio_import_'));
  assert.ok(
    (store.bootstrap().sections.resources as Resource[]).some((item) => item.id === importedMcp),
  );
  assert.equal(browsers, count + 2);
  console.log(
    JSON.stringify({
      ok: true,
      nativePi: pi.version,
      registeredClientSecret: true,
      pkce: true,
      cancelled: true,
      refresh: true,
      revoked: true,
      additionalScopeRequiresLogin: true,
      dynamicClientRegistration: true,
      importedMcpRestoredFromMissingNativeConfigAndAuthorized: true,
      exactIdleResume: !authOnly,
      resourcesReapplied: !authOnly,
      resumeRefresh: !authOnly,
      browserOpenedOnlyExplicitly: true,
      realExternalCredentials: false,
      modelRequests: 0,
    }),
  );
} finally {
  browser.close();
  await fixture.close();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
}
