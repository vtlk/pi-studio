import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RunChannel } from '../src/main/pi/RunChannel.ts';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import type { Agent } from '../src/shared/studio.ts';

// Actual native Pi MCP client + actual Cua FFI. No desktop pixels, input, permission prompts or model.
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-computer-native-')));
const channel = new RunChannel(),
  computer = new ComputerSupport();
const clients: { close(): Promise<void> }[] = [];
try {
  const pi = await checkPi('');
  const sdkPath = await resolvePiSdk(await realpath(pi.path));
  const { McpServerConnection, createDefaultTransport, McpOAuthCredentialStore } = await import(
    pathToFileURL(join(dirname(sdkPath), 'extensions/mcp/runtime.js')).href
  );
  const store = await StudioStore.open(join(root, 'Studio'));
  const agent: Agent = {
    id: 'qa',
    name: 'QA',
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
    instructions: [],
    model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'off', temperature: '' },
  };
  const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
    .projects[0];
  const projectRoot = await store.projects.directory(project.id);
  const counts: number[] = [];
  for (const visual of [true, false]) {
    const run = await buildRunContext(projectRoot, project, agent.id, [agent], []);
    await computer.bind(run, visual);
    const lease = await channel.add(
      run.record.runId,
      { record: run.record, instructions: '', resources: run.resources },
      async () => {},
      async () => ({}),
      [],
      computer.groups(run),
    );
    const envelope = await (
      await fetch(lease.url + '/context', { headers: { Authorization: `Bearer ${lease.token}` } })
    ).json();
    const client = new McpServerConnection({
      entry: envelope.resources.mcpServers[0],
      cwd: root,
      createTransport: createDefaultTransport,
      credentials: new McpOAuthCredentialStore(),
      onTools() {},
    });
    clients.push(client);
    await client.getClient();
    assert.equal(client.state, 'connected');
    assert.ok(client.tools.some((tool: { name: string }) => tool.name === 'check_permissions'));
    if (visual) assert.ok(client.tools.some((tool: { name: string }) => tool.name === 'click'));
    else
      assert.deepEqual(
        client.tools.map((tool: { name: string }) => tool.name),
        ['check_permissions'],
      );
    counts.push(client.tools.length);
    const result = await client.callTool('check_permissions', {}, {});
    assert.equal(result.isError, undefined);
    const status = JSON.parse(
      result.content.find((item: { type: string }) => item.type === 'text').text,
    );
    assert.equal(status.version, '0.49.11');
    assert.notEqual(status.phase, 'unavailable');
    assert.equal(
      result.content.some((item: { type: string }) => item.type === 'image'),
      false,
    );
    const prompt = await client.callTool('check_permissions', { prompt: true }, {});
    assert.equal(prompt.isError, true);
    await client.close();
    computer.release(run);
    channel.remove(run.record.runId);
    assert.equal(
      (await fetch(lease.url + '/context', { headers: { Authorization: `Bearer ${lease.token}` } }))
        .status,
      403,
    );
  }
  await computer.drain();
  const proof = {
    checkedAt: new Date().toISOString(),
    nativePi: pi.version,
    sdk: '0.49.11',
    actualNativeFfi: true,
    nativeMcpClient: true,
    visualToolCount: counts[0],
    textOnlyToolCount: counts[1],
    permissionPromptRejected: true,
    revokedLease: true,
    modelRequests: 0,
    desktopActions: 0,
    captureRequests: 0,
    limits:
      'Transport and promptless status only. Pi Studio TCC, actual capture/input and model visual loop remain unverified.',
  };
  await writeFile('artifacts/computer-mcp-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  channel.close();
  await computer.drain();
  await rm(root, { recursive: true, force: true });
}
