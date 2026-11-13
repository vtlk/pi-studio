import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Resource } from '../src/shared/resources.ts';

// Opt-in: a real service-agent request through native Pi MCP in an empty isolated studio.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-setup-'));
const service = new StudioService(join(root, 'preferences.json'), join(root, 'Studio'));
const pi = await checkPi('');
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
  const request = { projectId: 'pi-setup-assistant', agentId: 'setup', autoContinue: false };
  await helper.launch(
    request,
    `Use only the Pi Studio MCP tools. Read list_configuration, register exactly one connection named "QA subscription" for provider openai-codex, then create exactly one constructor agent named "QA configured agent" using that connection, model gpt-6.1-sol, reasoning Низкий, mainInstruction "QA current instruction". Install exactly the existing local Pi package at ${JSON.stringify(localPackage)} through install_package with name "QA local package", assign it to that one agent as kind plugins, then check_resource. Do not use bash or write files directly. Create no projects or extra profiles/resources. Do not ask questions. Finish with a short confirmation.`,
  );
  assert.equal(await children[0], 0);
  const state = (await service.load()).bootstrap();
  const agents = state.sections.agents as Agent[];
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'QA configured agent');
  assert.equal(agents[0].mainInstruction, 'QA current instruction');
  assert.equal(agents[0].model?.id, 'gpt-6.1-sol');
  assert.equal(agents[0].model?.provider, 'openai-codex');
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
  assert.ok(transcript.includes('mcp__pi_studio__configure_agent'));
  assert.ok(transcript.includes('mcp__pi_studio__install_package'));
  assert.ok(transcript.includes('mcp__pi_studio__check_resource'));
  await helper.launch(request);
  assert.equal(await children[1], 0);
  assert.equal(await readFile(join(directory, binding.path), 'utf8'), transcript);
  assert.equal(((await service.load()).bootstrap().sections.agents as Agent[]).length, 1);
  console.log(
    'Real setup assistant passed: requested connection/profile/model, native package install/check and assignment through administrative MCP, no extra profiles/resources/projects, exact idle resume.',
  );
} finally {
  helper.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
