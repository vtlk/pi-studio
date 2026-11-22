/** Opt-in real Pi + administration MCP + public HTTPS skill install in an owned temporary studio.
 * The model is a loopback SSE fixture: no paid provider, Terminal, UI or downloaded code execution.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { parseAgent } from '../src/main/storage/validation.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-native-skill-url-'));
const children: ChildProcess[] = [];
const exits: Promise<number | null>[] = [];
const owned: {
  close: () => void;
  server?: ReturnType<typeof createServer>;
  deadline?: ReturnType<typeof setTimeout>;
} = { close: () => {} };
let proof: Record<string, unknown> | undefined;
try {
  process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
  await mkdir(process.env.PI_CODING_AGENT_DIR);
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const source = 'https://github.com/MengTo/Skills';
  const skillPath = 'agent-skills/illustration/illustration-outlined-cartoon';
  const name = 'qa-remote-skill';
  const requestedAgent = 'assigned-agent';
  const calls: string[] = [];
  let requests = 0;
  let serverFailure: unknown;
  let diagnostics = '';
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, undefined);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.model, name);
      const step = requests++;
      assert.ok(step < 2, 'No unexpected model turns/retries');
      const tools = body.tools.map((item: { function: { name: string } }) => item.function.name);
      const tool = tools.find((item: string) => item.endsWith('install_skill_from_url'));
      assert.ok(tool, 'The actual native Pi tool catalog exposes the URL installer');
      const system = JSON.stringify(
        body.messages.filter((item: { role: string }) => item.role === 'system'),
      );
      assert.ok(system.includes('QA_NATIVE_SKILL_URL_ASSISTANT'));
      if (step) {
        const result = body.messages.findLast((item: { role: string }) => item.role === 'tool');
        assert.ok(result, 'Pi returned the MCP result to the model');
        assert.ok(
          JSON.stringify(result).includes('installed'),
          'Installer returned an explicit result',
        );
        const state = (await service.load()).bootstrap().sections;
        assert.equal(
          (state.resources as Resource[]).filter((item) => item.kind === 'skills').length,
          1,
          `The real administration call committed the downloaded skill: ${JSON.stringify(result).slice(0, 800)}`,
        );
      } else calls.push(tool);
      const delta = step
        ? { role: 'assistant', content: 'QA_NATIVE_SKILL_URL_DONE' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'install-public-skill',
                type: 'function',
                function: {
                  name: tool,
                  arguments: JSON.stringify({
                    url: source,
                    ref: 'main',
                    skillPath,
                    agentIds: [requestedAgent],
                  }),
                },
              },
            ],
          };
      const item = (delta: object, finish_reason: string | null) => ({
        id: 'qa-skill-' + step,
        object: 'chat.completion.chunk',
        created: 1,
        model: name,
        choices: [{ index: 0, delta, finish_reason }],
      });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify(item(delta, null))}\n\n`);
      response.end(
        `data: ${JSON.stringify({ ...item({}, step ? 'stop' : 'tool_calls'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      );
    } catch (error) {
      serverFailure ??= error;
      response.writeHead(500);
      response.end('QA rejected the model turn');
    }
  });
  owned.server = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const connection: Connection = {
    id: name,
    name,
    purpose: 'local',
    providerId: endpointProviderId(name),
    authScope: 'connection',
    endpoint: `http://127.0.0.1:${port}/v1`,
    account: '',
    createdAt: 1,
    endpointConfig: {
      api: 'openai-completions',
      auth: 'none',
      models: [
        {
          id: name,
          name,
          imageInput: false,
          reasoning: false,
          contextWindow: 32000,
          maxTokens: 1024,
        },
      ],
    },
  };
  const model = {
    connectionId: name,
    provider: connection.providerId,
    id: name,
    reasoning: 'off',
    temperature: '',
  };
  const profiles = [requestedAgent, 'unassigned-agent'].map((id) =>
    parseAgent({
      id,
      name: id,
      enabled: true,
      skills: [],
      mcps: [],
      plugins: [],
      instructions: [],
      mainInstruction: `Preserve ${id}`,
      model,
    }),
  );
  await store.saveSection('connections', [connection]);
  await store.saveSection('agentCatalog', {
    agents: profiles,
    teams: [{ id: 'qa-team', name: 'QA', agentIds: profiles.map((item) => item.id) }],
  });
  const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
  const assistant = systems.find((item) => item.systemRole === 'assistant')!;
  await store.saveSection(
    'systemAgents',
    systems.map((item) => ({
      ...item,
      mainInstruction: item.mainInstruction + '\nQA_NATIVE_SKILL_URL_ASSISTANT',
      model,
    })),
  );
  const project = (
    await store.command({
      kind: 'create',
      name: 'Existing project',
      teamId: 'qa-team',
      agents: store.teamProfiles('qa-team'),
    })
  ).projects[0];
  const projectPath = join(await store.projects.directory(project.id), 'project.json');
  const projectBefore = await readFile(projectPath);
  const sectionsBefore = store.bootstrap().sections;
  const pi = await checkPi('');
  assert.ok(pi.supported);
  const helper = createSetupAssistant(service, {
    bootstraps: join(root, 'boots'),
    bridge: fileURLToPath(new URL('../bundled/pi-bridge/session.mjs', import.meta.url)),
    catalog: fileURLToPath(new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url)),
    piPath: () => pi.path,
    headless: true,
    openTerminal: async (node, bridge, bootstrap) => {
      const child = spawn(node, [bridge, bootstrap], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      });
      children.push(child);
      child.stdout?.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-10000);
      });
      child.stderr?.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-10000);
      });
      exits.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
  });
  owned.close = () => helper.close();
  owned.deadline = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  }, 180000);
  const request = { projectId: 'pi-setup-assistant', agentId: assistant.id, autoContinue: false };
  await helper.launch(request);
  assert.equal(await exits[0], 0, diagnostics);
  assert.equal(requests, 0, 'Opening the helper is idle');
  await helper.launchServiceTask(
    request,
    'Install the requested public skill into the exact requested agent. Do not run any downloaded commands.',
  );
  assert.equal(await exits[1], 0, diagnostics);
  if (serverFailure) throw serverFailure;
  assert.equal(requests, 2);
  const sections = (await service.load()).bootstrap().sections;
  const skills = (sections.resources as Resource[]).filter((item) => item.kind === 'skills');
  assert.equal(skills.length, 1);
  const skill = skills[0];
  assert.equal(skill.name, 'illustration-outlined-cartoon');
  const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
  const loaded = sdk.loadSkills({
    cwd: root,
    agentDir: process.env.PI_CODING_AGENT_DIR,
    skillPaths: [skill.source],
    includeDefaults: false,
  });
  assert.equal(loaded.skills[0]?.name, skill.name, 'Pi can load the installed SKILL.md');
  const agents = sections.agents as Agent[];
  assert.deepEqual(agents.find((item) => item.id === requestedAgent)!.skills, [skill.id]);
  assert.deepEqual(agents.find((item) => item.id === 'unassigned-agent')!.skills, []);
  assert.deepEqual(sections.connections, sectionsBefore.connections);
  assert.deepEqual(sections.systemAgents, sectionsBefore.systemAgents);
  for (const agent of agents) {
    assert.deepEqual(agent.model, model);
    assert.equal(agent.mainInstruction, `Preserve ${agent.id}`);
  }
  assert.deepEqual(
    await readFile(projectPath),
    projectBefore,
    'Existing snapshots are not implicitly refreshed',
  );
  assert.ok(
    (await readFile(join(skill.source, 'SKILL.md'), 'utf8')).includes(
      'illustration-outlined-cartoon',
    ),
  );
  assert.ok(
    (await readdir(join(skill.source, 'scripts'))).length > 0,
    'Companion scripts are preserved without execution',
  );
  const historyRoot = join(store.folder, '.pistudio/setup-assistant');
  const binding = JSON.parse(await readFile(join(historyRoot, 'state.json'), 'utf8')).session;
  const history = await readFile(join(historyRoot, binding.path), 'utf8');
  assert.ok(history.includes('githubCommit'));
  assert.ok(history.includes('QA_NATIVE_SKILL_URL_DONE'));
  await helper.launch(request);
  assert.equal(await exits[2], 0, diagnostics);
  assert.equal(requests, 2, 'Reopening sends nothing and does not reinstall');
  const receipts: Record<string, unknown>[] = [];
  function receipt(value: unknown, depth = 0) {
    if (depth > 8) return;
    if (typeof value === 'string') {
      try {
        receipt(JSON.parse(value), depth + 1);
      } catch {}
    } else if (value && typeof value === 'object') {
      if ('installed' in value && value.installed === true && 'githubCommit' in value)
        receipts.push(value as Record<string, unknown>);
      else for (const item of Object.values(value)) receipt(item, depth + 1);
    }
  }
  for (const line of history.trim().split('\n')) receipt(JSON.parse(line));
  assert.equal(
    receipts.length,
    1,
    'One successful installer receipt is persisted in the actual Pi dialogue',
  );
  assert.match(String(receipts[0].githubCommit), /^[a-f0-9]{40,64}$/);
  assert.equal(receipts[0].archiveSha256, undefined);
  proof = {
    checkedAt: new Date().toISOString(),
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    pi: pi.version,
    realPiSdkAndProductionBridge: true,
    realAdministrationMcpTool: calls[0],
    realPublicGitHubHttpsDownload: source,
    resolvedGitHubCommit: receipts[0].githubCommit,
    downloadedGitHubFolder: skillPath,
    frontmatterNormalized: receipts[0].frontmatterNormalized === true,
    nativePiSkillLoaderVerified: true,
    localSyntheticModelOnly: true,
    paidModelRequests: 0,
    exactAgentAssignmentAndCompanionFiles: true,
    openingAndResumeSendNothing: true,
    connectionsPromptsModelsAndExistingProjectPreserved: true,
    downloadedProgramsExecuted: false,
    userStudioOrProcessesChanged: false,
    windowsNativeAcceptance: false,
    limitation:
      'Real Pi/HTTPS/MCP on macOS with a loopback model. No Terminal/UI, native Windows or external account acceptance.',
    ownedTemporaryStudioRemoved: true,
  };
} finally {
  clearTimeout(owned.deadline);
  owned.close();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  if (owned.server?.listening)
    await new Promise<void>((resolve) => owned.server!.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
assert.ok(proof);
await writeFile(
  new URL('../artifacts/remote-skill-native-pi-proof.json', import.meta.url),
  JSON.stringify(proof, null, 2) + '\n',
);
console.log(JSON.stringify(proof));
