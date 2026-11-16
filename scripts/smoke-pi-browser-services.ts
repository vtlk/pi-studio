import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { BrowserSupport } from '../src/main/browser/BrowserSupport.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';
import type { SessionBinding } from '../src/shared/project.ts';

// Actual service factories + packaged bridge/MCP. Three short subscription requests in a disposable studio.
assert.ok(
  process.argv[2] && process.argv[3],
  'Pass installed QA browser runtime and packaged pi-bridge directory.',
);
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-browser-services-')));
const runtime = resolve(process.argv[2]),
  bridge = resolve(process.argv[3]);
const browser = new BrowserSupport(runtime, join(bridge, 'browser/server.mjs'));
assert.equal((await browser.check()).status, 'available');
const previousProfiles = new Set(await readdir(join(runtime, 'dialogues')).catch(() => []));
let pages = 0;
const server = createServer((req, res) => {
  pages++;
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><body style="font:48px system-ui;margin:80px">SERVICE: BROWSER_READY_73</body>',
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/`;
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const model = {
  connectionId: 'qa',
  provider: 'openai-codex',
  id: 'gpt-5.6-luna',
  reasoning: 'Средний',
  temperature: '',
};
await store.saveSection('connections', [
  {
    id: 'qa',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
await store.saveSection(
  'systemAgents',
  systems.map((agent) => ({
    ...agent,
    model,
    mainInstruction:
      'Perform only the explicit current QA request. No installations or extra configuration.',
  })),
);
const profile = (store.bootstrap().sections.systemAgents as SystemAgent[])[0];
const agent: Agent = {
  id: 'library-browser-qa',
  name: 'QA library browser',
  enabled: true,
  model,
  skills: [],
  mcps: ['pistudio-library'],
  plugins: [],
  instructions: [],
  mainInstruction:
    'Follow only the current explicit QA task. Native bash/write may save requested test results in output.',
};
await store.saveSection('agents', [agent]);
const children: Promise<number | null>[] = [],
  processes: ReturnType<typeof spawn>[] = [];
const options = {
  browser,
  bootstraps: join(root, 'boots'),
  bridge: join(bridge, 'session.mjs'),
  catalog: join(bridge, 'catalog.mjs'),
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node: string, script: string, bootstrap: string) => {
    const child = spawn(node, [script, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    processes.push(child);
    children.push(
      new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      }),
    );
  },
};
const native = new StudioResources(service, {
  browser,
  piPath: options.piPath,
  script: join(bridge, 'resources.mjs'),
});
const helper = createSetupAssistant(service, { ...options, resources: native });
const controllers = [helper];
const timer = setTimeout(() => {
  for (const controller of controllers) controller.close();
  for (const process of processes) process.kill('SIGTERM');
}, 240000);
const messages = (text: string) =>
  text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((item) => item.type === 'message')
    .map((item) => item.message);
const calls = (text: string) =>
  messages(text)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content ?? [])
    .filter((part) => part.type === 'toolCall');
async function contextHasBrowser(project: string, runId: string) {
  const context = JSON.parse(
    await readFile(join(project, '.pistudio/context', runId, 'context.json'), 'utf8'),
  );
  assert.ok(context.resourceIds.mcps.includes('pistudio-browser'));
}
try {
  const request = { projectId: 'pi-setup-assistant', agentId: profile.id, autoContinue: false };
  await helper.launch(request);
  assert.equal(await children[0], 0);
  assert.equal(pages, 0, 'Opening the helper must not launch the browser or send a model request.');
  // Existing private QA harness path, without a production request field or Terminal automation.
  const input = helper as unknown as {
    open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
  };
  const started = await input.open(
    request,
    `Use browser_open to open ${url}. Read the SERVICE value from the returned screenshot. Use native write/bash only to write that value and a newline to output/browser-service.txt. Also call Pi Studio check_resource with resourceId pistudio-browser. Do not install/configure anything, use DOM/HTML/eval, or create assets. Finish with a short confirmation.`,
  );
  assert.equal(await children[1], 0);
  const helperRoot = join(store.folder, '.pistudio/setup-assistant');
  const state = JSON.parse(await readFile(join(helperRoot, 'state.json'), 'utf8')) as {
    session: SessionBinding;
    outputPath: string;
  };
  const helperTranscript = await readFile(join(helperRoot, state.session.path), 'utf8');
  assert.equal(
    (await readFile(join(helperRoot, state.outputPath, 'browser-service.txt'), 'utf8')).trim(),
    'BROWSER_READY_73',
  );
  assert.ok(calls(helperTranscript).some((call) => call.name.endsWith('browser_open')));
  assert.ok(calls(helperTranscript).some((call) => call.name.endsWith('check_resource')));
  assert.ok(
    messages(helperTranscript).some(
      (message) =>
        message.role === 'toolResult' && message.content?.some((part) => part.type === 'image'),
    ),
  );
  await contextHasBrowser(helperRoot, started.runId);
  const pagesAfterHelper = pages;
  await helper.launch(request);
  assert.equal(await children[2], 0);
  assert.equal(await readFile(join(helperRoot, state.session.path), 'utf8'), helperTranscript);
  assert.equal(pages, pagesAfterHelper);

  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/browser-services-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        packagedBridgeVersion: '0.2.0-alpha.55',
        nativePi: pi.version,
        model: model.id,
        explicitUserRequests: 1,
        actualSubscription: true,
        helperPublicOpenIdle: true,
        helperImageAndResourceCheck: true,
        helperExactResumeWithoutReplay: true,
        personalStudioUsed: false,
        terminalUiUsed: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Actual native Pi helper browser service checks passed.');
} finally {
  clearTimeout(timer);
  for (const controller of controllers) controller.close();
  browser.close();
  await Promise.allSettled(children);
  for (const name of await readdir(join(runtime, 'dialogues')).catch(() => []))
    if (!previousProfiles.has(name))
      await rm(join(runtime, 'dialogues', name), { recursive: true, force: true });
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
