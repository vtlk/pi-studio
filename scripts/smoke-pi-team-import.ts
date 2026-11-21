import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { createTeamImportTools } from '../src/main/teams/createTeamImportTools.ts';
import { importTeam } from '../src/main/teams/importTeam.ts';
import { encodePackage, fileDigest } from '../src/main/teams/packageCodec.ts';
import { handoffTeamImport } from '../src/main/teams/handoffTeamImport.ts';
import { readImport } from '../src/main/teams/importState.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-import-native-'));
process.env.PI_CODING_AGENT_DIR = join(root, 'Agent');
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
let requests = 0,
  reportId = '',
  teamId = '',
  mcpId = '',
  packageId = '',
  mcpListed = 0;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === '/mcp') {
      if (!('id' in body)) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (body.method === 'tools/list') mcpListed++;
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: body.params.protocolVersion,
              serverInfo: { name: 'Import MCP', version: '1' },
              capabilities: { tools: {} },
            }
          : body.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'import_probe',
                    description: 'Isolated import probe',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              }
            : { content: [{ type: 'text', text: 'OK' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(body.model, 'qa-import');
    const content = JSON.stringify(body.messages);
    assert.ok(content.includes(reportId));
    assert.ok(content.includes(teamId));
    const step = requests++;
    const toolName = [
      'read_team_import',
      'read_team_import_file',
      'restore_team_import_resource',
      'restore_team_import_resource',
      'check_team_import',
      '',
    ][step];
    if (step >= 1)
      assert.ok(
        content.includes('PACKAGE_CURRENT_ROLE'),
        'Manifest delivered through real native MCP',
      );
    if (step >= 2)
      assert.ok(
        content.includes('PACKAGE_CURRENT_SKILL'),
        'Package file delivered through real native MCP',
      );
    if (step >= 5)
      assert.ok(content.includes('productionAgentsLaunched'), 'Actual check result delivered');
    const tool = body.tools?.find((entry: { function: { name: string } }) =>
      entry.function.name.endsWith(toolName),
    );
    const args =
      step === 1
        ? { packageId: reportId, path: 'resources/resource-1/files/SKILL.md' }
        : step === 2
          ? { packageId: reportId, resourceId: mcpId }
          : step === 3
            ? { packageId: reportId, resourceId: packageId }
            : { packageId: reportId };
    if (toolName) assert.ok(tool, 'Native administrative tool exposed: ' + toolName);
    const delta = toolName
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'import-' + step,
              type: 'function',
              function: { name: tool.function.name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : {
          role: 'assistant',
          content: 'Imported package inspected; explicit model mapping is required.',
        };
    const item = (delta: object, finish_reason: string | null) => ({
      id: 'import-' + step,
      object: 'chat.completion.chunk',
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
    res.write(`data: ${JSON.stringify(item({}, toolName ? 'tool_calls' : 'stop'))}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end('QA assertion failed');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const connection = {
  id: 'qa-import',
  name: 'Local import QA',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-import'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-import',
        name: 'QA import',
        imageInput: false,
        reasoning: false,
        contextWindow: 32768,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
await store.saveSection(
  'systemAgents',
  systems.map((agent) => ({
    ...agent,
    model: {
      connectionId: connection.id,
      provider: connection.providerId,
      id: 'qa-import',
      reasoning: 'По умолчанию',
      temperature: '',
    },
  })),
);
const packageJson = Buffer.from(
  JSON.stringify({ name: 'qa-import-local', version: '1.2.3', pi: { extensions: ['./index.ts'] } }),
);
const packageEntry = Buffer.from('export default function() {}\n');
const file = Buffer.from(
  '---\nname: import-qa-skill\ndescription: Imported QA resource\n---\nPACKAGE_CURRENT_SKILL\n',
);
const imported = await importTeam(
  store,
  encodePackage({
    manifest: {
      format: 'pi-studio-team',
      version: 1,
      team: { name: 'Native QA team' },
      agents: [
        {
          id: 'original-agent',
          name: 'Imported role',
          enabled: true,
          mainInstruction: 'PACKAGE_CURRENT_ROLE',
          instructions: [],
          skills: ['resource-1'],
          mcps: ['resource-2'],
          plugins: ['resource-3'],
          model: {
            connectionId: 'connection-1',
            provider: 'required-provider',
            id: 'required-model',
            reasoning: 'high',
            temperature: '',
          },
        },
      ],
      resources: [
        {
          id: 'resource-1',
          name: 'Imported skill',
          kind: 'skills',
          description: '',
          version: 'current',
          source: 'local',
          filesRoot: 'resources/resource-1/files',
          requirements: [],
        },
        {
          id: 'resource-2',
          name: 'Local MCP',
          kind: 'mcps',
          description: '',
          version: '1',
          source: `http://127.0.0.1:${port}/mcp`,
          mcp: { url: `http://127.0.0.1:${port}/mcp` },
          requirements: [],
        },
        {
          id: 'resource-3',
          name: 'Local Pi package',
          kind: 'plugins',
          description: '',
          version: '1.2.3',
          source: 'local',
          filesRoot: 'resources/resource-3/files',
          requirements: [],
        },
      ],
      connections: [
        {
          id: 'connection-1',
          name: 'Required connection',
          provider: 'required-provider',
          purpose: 'pi',
        },
      ],
      requirements: [],
    },
    files: [
      {
        path: 'resources/resource-1/files/SKILL.md',
        data: file.toString('base64'),
        sha256: fileDigest(file),
        executable: false,
      },
      {
        path: 'resources/resource-3/files/package.json',
        data: packageJson.toString('base64'),
        sha256: fileDigest(packageJson),
        executable: false,
      },
      {
        path: 'resources/resource-3/files/index.ts',
        data: packageEntry.toString('base64'),
        sha256: fileDigest(packageEntry),
        executable: false,
      },
    ],
  }),
);
reportId = imported.id;
teamId = imported.teamId;
const importState = await readImport(store, reportId);
mcpId = importState.state.resourceMap['resource-2'];
packageId = importState.state.resourceMap['resource-3'];
const bridgeDirectory =
  process.env.PI_STUDIO_QA_BRIDGE_DIRECTORY ||
  new URL('../bundled/pi-bridge', import.meta.url).pathname;
const native = new StudioResources(service, {
  script: join(bridgeDirectory, 'resources.mjs'),
  piPath: () => pi.path,
});
const imports = createTeamImportTools(service, native, {
  userData: root,
  bridgeDirectory,
  piPath: () => pi.path,
});
const children: Promise<number | null>[] = [];
const host = createSetupAssistant(service, {
  teamImports: imports,
  resources: native,
  bootstraps: join(root, 'setup-bootstraps'),
  bridge: join(bridgeDirectory, 'session.mjs'),
  catalog: join(bridgeDirectory, 'catalog.mjs'),
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
try {
  await handoffTeamImport(service, host, store.folder, reportId);
  assert.equal(await children[0], 0);
  assert.equal(requests, 6);
  const checked = (await readImport(store, reportId)).state.report;
  assert.equal(checked.handoff, 'sent');
  assert.ok(checked.agents[0].issues.length > 0);
  assert.deepEqual(store.bootstrap().projects, []);
  assert.ok(mcpListed > 0, 'Actual native imported MCP tool discovery');
  assert.ok(
    (store.bootstrap().sections.resources as { id: string; version: string }[]).find(
      (resource) => resource.id === packageId,
    )?.version === '1.2.3',
  );
  const statePath = join(store.folder, '.pistudio/setup-assistant/state.json');
  const binding = JSON.parse(await readFile(statePath, 'utf8')).session;
  const transcriptPath = join(store.folder, '.pistudio/setup-assistant', binding.path),
    before = await readFile(transcriptPath, 'utf8');
  assert.ok(before.includes('read_team_import'));
  assert.equal(
    (before.match(/Настрой импортированную команду|Set up imported team/g) || []).length,
    1,
  );
  await handoffTeamImport(service, host, store.folder, reportId);
  assert.equal(await children[1], 0);
  assert.equal(requests, 6);
  assert.equal(await readFile(transcriptPath, 'utf8'), before);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).session.path, binding.path);
  const proof = {
    passed: true,
    pi: pi.version,
    realNativeAdministrativeMcp: true,
    validatedPackageManifestAndFileRead: true,
    actualResourceChecks: true,
    importedMcpConfiguredAndConnected: true,
    localPiPackageInstalledWithSameAssignmentId: true,
    nativeMcpListCalls: mcpListed,
    missingModelNeverReplaced: true,
    oneTaskInCanonicalDialogue: true,
    exactIdleResumeWithoutReplay: true,
    productionProjectsCreated: 0,
    productionAgentsLaunched: 0,
    localModelRequests: requests,
    externalModelRequests: 0,
    scope:
      'Actual pinned Pi/production service RunHost and MCP; synthetic loopback model, headless, isolated Studio, no Terminal UI/user data.',
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/native-team-import-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  host.close();
  await Promise.allSettled(children);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
