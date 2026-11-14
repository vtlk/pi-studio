import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { libraryMcpId } from '../src/shared/builtinResources.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Opt-in: a real service-agent request through native Pi MCP in an empty isolated studio.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-setup-'));
const service = new StudioService(join(root, 'preferences.json'), join(root, 'Studio'));
const pi = await checkPi('');
const store = await service.load();
const connectionId = 'qa-configured-account';
await store.saveSection('connections', [
  {
    id: connectionId,
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
const helperProfile = systems.find((agent) => agent.systemRole === 'assistant')!;
const roleProof = 'QA_CURRENT_EDITED_SERVICE_ROLE';
await store.saveSection(
  'systemAgents',
  systems.map((agent) =>
    agent.id === helperProfile.id
      ? {
          ...agent,
          mainInstruction: agent.mainInstruction + `\nЗаверши ответ строкой ${roleProof}.`,
          model: {
            connectionId,
            provider: 'openai-codex',
            id: 'gpt-6.1-sol',
            reasoning: 'Низкий',
            temperature: '',
          },
        }
      : agent,
  ),
);
const localPackage = join(root, 'qa-package');
await mkdir(join(localPackage, 'qa-setup-skill'), { recursive: true });
await writeFile(
  join(localPackage, 'package.json'),
  JSON.stringify({
    name: 'qa-setup-package',
    version: '1.2.3',
    pi: { skills: ['./qa-setup-skill'] },
  }),
);
await writeFile(
  join(localPackage, 'qa-setup-skill/SKILL.md'),
  '---\nname: qa-setup-skill\ndescription: Isolated setup test\n---\n\nKeep user data unchanged.',
);
const children: Promise<number | null>[] = [];
const helper = createSetupAssistant(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
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
  const request = {
    projectId: 'pi-setup-assistant',
    agentId: helperProfile.id,
    autoContinue: false,
  };
  await helper.launch(request);
  assert.equal(await children[0], 0);
  assert.deepEqual(
    (await service.load()).bootstrap().sections.agents,
    [],
    'The public helper entry point opens idle; it must not send a task or configure anything',
  );
  // QA only: the production entry point deliberately accepts no first message.
  // Exercise the existing internal open path with one explicit synthetic user
  // request instead of adding a test-only IPC/API or automating Terminal input.
  const headlessRequest = helper as unknown as {
    open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
  };
  await headlessRequest.open(
    request,
    `Use only the Pi Studio MCP tools. Read list_configuration and use the existing connection named "QA subscription" for provider openai-codex. Create exactly one ordinary constructor agent named "QA configured agent" using that connection, model gpt-6.1-sol, reasoning Низкий, mainInstruction "QA current instruction". Assign the existing built-in Pi Studio Library MCP (resourceId ${libraryMcpId}, kind mcps) to that ordinary agent. Do not assign it to the setup assistant. Install exactly the existing local Pi package at ${JSON.stringify(localPackage)} through install_package with name "QA local package", assign it to that one agent as kind plugins, then check_resource. Do not use bash or write files directly. Create no projects, connections or extra profiles/resources. Do not ask questions. Finish with a short confirmation.`,
  );
  assert.equal(await children[1], 0);
  const state = (await service.load()).bootstrap();
  const agents = state.sections.agents as Agent[];
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'QA configured agent');
  assert.equal(agents[0].mainInstruction, 'QA current instruction');
  assert.equal(agents[0].model?.id, 'gpt-6.1-sol');
  assert.equal(agents[0].model?.provider, 'openai-codex');
  assert.ok(agents[0].mcps.includes(libraryMcpId));
  const remainingSystems = state.sections.systemAgents as SystemAgent[];
  assert.equal(remainingSystems.length, 1);
  assert.equal(remainingSystems[0].systemRole, 'assistant');
  assert.ok(!remainingSystems[0].mcps.includes(libraryMcpId));
  assert.equal((state.sections.connections as unknown[]).length, 1);
  const resources = state.sections.resources as Resource[];
  assert.equal(resources.length, 1);
  assert.equal(resources[0].kind, 'plugins');
  assert.equal(resources[0].name, 'QA local package');
  assert.equal(resources[0].version, '1.2.3');
  assert.equal(resources[0].check?.status, 'available');
  assert.deepEqual(agents[0].plugins, [resources[0].id]);
  assert.deepEqual(state.projects, []);
  const directory = join(state.folder, '.pistudio/setup-assistant');
  const binding = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).session;
  const transcript = await readFile(join(directory, binding.path), 'utf8');
  assert.ok(
    transcript.includes(roleProof),
    'The actual response must reflect the edited current system role.',
  );
  assert.ok(transcript.includes('mcp__pi_studio__configure_agent'));
  assert.ok(transcript.includes('mcp__pi_studio__install_package'));
  assert.ok(transcript.includes('mcp__pi_studio__check_resource'));
  await helper.launch(request);
  assert.equal(await children[2], 0);
  assert.equal(await readFile(join(directory, binding.path), 'utf8'), transcript);
  assert.equal(((await service.load()).bootstrap().sections.agents as Agent[]).length, 1);
  // Reproduce the previous helper's real SDK cwd/layout, without editing or fabricating JSONL.
  const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
  const legacyCwd = join(directory, 'agents/setup'),
    legacySessions = join(legacyCwd, 'sessions');
  await mkdir(legacySessions, { recursive: true });
  await mkdir(join(legacyCwd, 'output'), { recursive: true });
  const legacy = sdk.SessionManager.forkFrom(
    join(directory, binding.path),
    legacyCwd,
    legacySessions,
  );
  const legacyFile = legacy.getSessionFile();
  assert.ok(legacyFile);
  const legacyBytes = await readFile(legacyFile, 'utf8');
  await writeFile(
    join(directory, 'state.json'),
    JSON.stringify({
      schemaVersion: 1,
      session: {
        id: legacy.getSessionId(),
        path: relative(directory, legacyFile),
        createdAt: 1,
        title: 'Old helper',
      },
    }),
  );
  const current = (await service.load()).bootstrap().sections.systemAgents as SystemAgent[];
  await store.saveSection(
    'systemAgents',
    current.map((agent) =>
      agent.id === helperProfile.id ? { ...agent, name: 'Renamed helper' } : agent,
    ),
  );
  await helper.launch(request);
  assert.equal(await children[3], 0);
  assert.equal(await readFile(legacyFile, 'utf8'), legacyBytes);
  const legacyState = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(legacyState.session.path, relative(directory, legacyFile));
  assert.equal(legacyState.outputPath, 'agents/setup/output');
  console.log(
    'Real setup assistant passed: edited system role and explicit model, native package install/check/assignment, no extra profiles/resources/projects, exact idle resume and preserved legacy setup cwd/dialogue after rename.',
  );
} finally {
  helper.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
