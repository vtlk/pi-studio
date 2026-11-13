import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { nativeResourceOperation } from '../src/main/pi/NativeResources.ts';
import { assertCredentialReferences, packageSource } from '../src/main/pi/resourceConfig.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';

test('secret-free native configuration accepts supported OAuth/env/provider forms and rejects literal credentials', () => {
  for (const config of [
    {
      url: 'https://example.test/mcp',
      oauth: {
        clientId: 'public-id',
        clientSecret: '${SECRET}',
        callbackUrl: 'http://127.0.0.1/callback',
        clientRegistration: 'cimd',
      },
    },
    {
      command: 'server',
      args: ['--api-key', '${API_KEY}'],
      env: { API_KEY: '!security find-generic-password -s service -w', PORT: '1234' },
    },
    {
      url: 'https://example.test/mcp',
      auth: { provider: 'openai-codex' },
      headers: { Authorization: 'Bearer ${TOKEN}' },
    },
  ])
    assert.doesNotThrow(() => assertCredentialReferences(config));
  for (const config of [
    { url: 'https://user:password@example.test/mcp' },
    { url: 'https://example.test/mcp?api_key=secret' },
    { headers: { Authorization: 'Bearer DO_NOT_PERSIST' } },
    { env: { API_KEY: 'DO_NOT_PERSIST' } },
    { oauth: { clientSecret: 'DO_NOT_PERSIST' } },
    { args: ['--api-key=DO_NOT_PERSIST'] },
  ])
    assert.throws(() => assertCredentialReferences(config));
  assert.equal(packageSource('npm:@example/package@1.2.3'), 'npm:@example/package@1.2.3');
  assert.throws(() => packageSource('git:https://user:password@example.test/repo'));
});

test(
  'native Pi validates/configures/checks only the chosen MCP and resolves packages without global auto-load',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-native-resources-'));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const nativeDir = join(root, 'native-pi');
    await mkdir(nativeDir);
    process.env.PI_CODING_AGENT_DIR = nativeDir;
    t.after(async () => {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(root, { recursive: true, force: true });
    });
    const server = createServer(async (request, response) => {
      if (request.url === '/auth') {
        response.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="test"' });
        response.end();
        return;
      }
      if (request.method !== 'POST') {
        response.writeHead(405);
        response.end();
        return;
      }
      let text = '';
      for await (const chunk of request) text += chunk;
      const data = JSON.parse(text);
      if (!('id' in data)) {
        response.writeHead(202);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const result =
        data.method === 'initialize'
          ? {
              protocolVersion: data.params.protocolVersion,
              serverInfo: { name: 'QA resource', version: '1' },
              capabilities: { tools: {} },
            }
          : data.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'test_resource',
                    description: 'Read-only test',
                    inputSchema: { type: 'object' },
                  },
                ],
              }
            : {};
      response.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const marker = join(root, 'unselected-started');
    await writeFile(
      join(nativeDir, 'mcp.json'),
      JSON.stringify({
        autoEnableCodemode: false,
        mcpServers: {
          unrelated: {
            command: process.execPath,
            args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'BAD')`],
          },
        },
      }),
    );
    const pi = await checkPi('');
    const script = new URL('../bundled/pi-bridge/resources.mjs', import.meta.url).pathname;
    const call = (request: Parameters<typeof nativeResourceOperation>[2]) =>
      nativeResourceOperation(pi.path, script, request);
    await call({
      action: 'configure-mcp',
      cwd: root,
      name: 'selected',
      config: {
        url: `${url}/mcp`,
        oauth: { clientId: 'test-public-client', clientRegistration: 'dcr' },
      },
    });
    await assert.rejects(
      call({ action: 'configure-mcp', cwd: root, name: 'selected', config: { url: `${url}/mcp` } }),
    );
    const native = JSON.parse(await readFile(join(nativeDir, 'mcp.json'), 'utf8'));
    assert.equal(native.autoEnableCodemode, false);
    assert.ok(native.mcpServers.unrelated);
    assert.equal(native.mcpServers.selected.oauth.clientRegistration, 'dcr');
    const checked = await call({ action: 'check-mcp', cwd: root, name: 'selected' });
    assert.equal(checked.status, 'available');
    assert.equal(checked.toolCount, 1);
    await assert.rejects(access(marker), 'Unselected native MCP must never execute');
    const auth = await call({
      action: 'check-mcp',
      cwd: root,
      name: 'needs_login',
      config: { url: `${url}/auth` },
    });
    assert.equal(auth.status, 'needs_auth');
    const local = join(root, 'local-package');
    await mkdir(join(local, 'skill'), { recursive: true });
    await writeFile(
      join(local, 'package.json'),
      JSON.stringify({
        name: 'qa-pi-package',
        version: '1.2.3',
        pi: { extensions: ['./extension.ts'], skills: ['./skill'] },
      }),
    );
    await writeFile(
      join(local, 'extension.ts'),
      'export default function(pi) { pi.registerTool({name:"qa_resource_tool",description:"test",parameters:{type:"object",properties:{}},execute:async()=>({content:[{type:"text",text:"ok"}]})}); }',
    );
    await writeFile(
      join(local, 'skill/SKILL.md'),
      '---\nname: qa-resource\ndescription: Test resource only\n---\n\nDo not change application files.',
    );
    const installed = await call({ action: 'install-package', cwd: root, source: local });
    assert.equal(installed.status, 'available');
    assert.equal(installed.count, 2);
    assert.equal(installed.version, '1.2.3');
    assert.equal(
      (await call({ action: 'check-package', cwd: root, source: local })).status,
      'available',
    );
    await assert.rejects(
      access(join(nativeDir, 'settings.json')),
      'No global packages should be auto-loaded',
    );
  },
);

test('Studio resource metadata stays scoped, records real checks, deduplicates imports and preserves snapshots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const resources = new StudioResources(service, {
    script: '',
    logins: join(root, 'logins'),
    piPath: () => '',
    operation: async (_pi, _script, request) =>
      request.action === 'list-mcp'
        ? { servers: [{ name: 'qa', transport: 'HTTP', description: 'Test', enabled: true }] }
        : { status: 'available', toolCount: 3 },
  });
  const first = await resources.importMcp(store.folder, 'qa');
  assert.equal((await resources.importMcp(store.folder, 'qa')).id, first.id);
  assert.equal((store.bootstrap().sections.resources as unknown[]).length, 1);
  assert.deepEqual(await resources.check(first.id), {
    status: 'available',
    checkedAt: (store.bootstrap().sections.resources as (typeof first)[])[0].check!.checkedAt,
    toolCount: 3,
  });
  const reopened = await (
    await import('../src/main/storage/StudioStore.ts')
  ).StudioStore.open(store.folder);
  assert.equal(
    (reopened.bootstrap().sections.resources as (typeof first)[])[0].check!.toolCount,
    3,
  );
  await service.open(join(root, 'Other'));
  await assert.rejects(resources.importMcp(store.folder, 'qa'), /изменилась/);
});
