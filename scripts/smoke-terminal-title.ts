import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { Agent } from '../src/shared/studio.ts';

// Owned pseudo-terminals only: no Terminal.app, OS focus, keyboard input or user studio.
const root = await mkdtemp(join(tmpdir(), 'pistudio-terminal-title-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
assert.equal(pi.supported, true);
await mkdir(join(root, 'pi-agent/extensions'), { recursive: true });
await writeFile(
  join(root, 'pi-agent/extensions/qa-title.ts'),
  `
export default function(pi) {
  const record = ${JSON.stringify(join(root, 'title-events.txt'))};
  pi.on('agent_start', async (_event, ctx) => {
    const {appendFile} = await import('node:fs/promises');
    await appendFile(record, 'start\\n');
    ctx.ui.setTitle('UNWANTED_QA_RUNNING_TITLE');
  });
  pi.on('agent_end', async (_event, ctx) => {
    const {appendFile} = await import('node:fs/promises');
    await appendFile(record, 'end\\n');
    ctx.ui.setTitle('UNWANTED_QA_SETTLED_TITLE');
  });
}
`,
);
let requests = 0;
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(body.model, 'qa-title');
  requests++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: 'qa-title',
    object: 'chat.completion.chunk',
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.end(
    `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'TITLE_QA_OK' }, null))}\n\ndata: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const connection = {
  id: 'qa-title',
  name: 'Local title fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-title'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-title',
        name: 'QA title',
        imageInput: false,
        reasoning: false,
        contextWindow: 16384,
        maxTokens: 128,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const agent = (id: string, name: string): Agent => ({
  id,
  name,
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
  mainInstruction: 'Reply briefly. This is a local terminal-title test.',
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-title',
    reasoning: 'По умолчанию',
    temperature: '',
  },
});
const agents = [agent('writer', 'Сценарист «А»'), agent('scenes', 'Сцены "Б" $() `x`')];
await store.saveSection('agents', agents);
const projects = [];
for (let i = 0; i < agents.length; i++) {
  const result = await store.command({
    kind: 'create',
    name: i === 0 ? 'Проект "А"' : 'Другой проект',
    agents: [agents[i]],
  });
  projects.push(result.projects[0]);
}
const sessions: { title: string; output: string; exited: Promise<number | null> }[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge:
    process.env.PI_STUDIO_QA_BRIDGE ||
    new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  openTerminal: async (node, bridge, bootstrap, title) => {
    assert.ok(title);
    const child = spawn(
      'python3',
      [
        '-c',
        `
import errno, os, pty, sys
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
while True:
    try:
        data = os.read(master, 65536)
        if not data: break
        os.write(1, data)
    except OSError as error:
        if error.errno == errno.EIO: break
        raise
os.close(master)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`,
        node,
        bridge,
        bootstrap,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          PI_OFFLINE: '1',
          PI_TELEMETRY: '0',
          PI_CODING_AGENT_DIR: join(root, 'pi-agent'),
        },
      },
    );
    const session = {
      title,
      output: '',
      exited: new Promise<number | null>((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      }),
    };
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      session.output += data;
    });
    // Keep diagnostics out of the user's terminal; assertions below expose only safe test labels.
    child.stderr.setEncoding('utf8').on('data', (data: string) => {
      session.output += data;
    });
    sessions.push(session);
  },
});
async function settled(projectId: string, agentId: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const current = (await store.projects.read(projectId)).agents.find(
      (a) => a.profile.id === agentId,
    )!;
    if (current.runStatus === 'error') throw new Error('Isolated interactive Pi failed');
    if (current.session && current.runStatus === 'waiting') {
      const directory = await store.projects.directory(projectId);
      const entries = (await readFile(join(directory, current.session.path), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (entries.some((entry) => entry.type === 'message' && entry.message.role === 'assistant'))
        return current;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('Interactive response did not settle');
}
try {
  for (let i = 0; i < agents.length; i++) {
    await host.launch({
      projectId: projects[i].id,
      agentId: agents[i].id,
      firstMessage: 'Reply TITLE_QA_OK.',
      autoContinue: false,
    });
    await settled(projects[i].id, agents[i].id);
  }
  assert.equal(requests, 2);
  const first = await store.projects.read(projects[0].id);
  const directory = await store.projects.directory(first.id);
  const binding = first.agents[0].session!;
  const transcript = await readFile(join(directory, binding.path));
  await host.launch({ projectId: first.id, agentId: agents[0].id, autoContinue: false });
  assert.equal(requests, 2, 'Resume must not send a model request');
  assert.deepEqual(await readFile(join(directory, binding.path)), transcript);
  assert.equal((await store.projects.read(first.id)).agents[0].session!.path, binding.path);
  await host.withProjectChange(first.id, true, () =>
    store.command({ kind: 'rename', projectId: first.id, name: 'Новое имя "В"' }),
  );
  await host.launch({ projectId: first.id, agentId: agents[0].id, autoContinue: false });
  assert.equal(requests, 2);
  assert.equal(sessions[3].title, 'Сценарист «А» · Новое имя "В"');
  await host.drain();
  for (const session of sessions) {
    await session.exited;
    const titles = [...session.output.matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map((m) => m[1]);
    assert.ok(
      titles.length >= (session === sessions[0] || session === sessions[1] ? 3 : 1),
      'Actual Pi and native extension must emit titles during initialization and dialogue',
    );
    assert.ok(
      titles.every((title) => title === session.title),
      'Pi must not overwrite its assigned title',
    );
  }
  assert.equal(sessions.length, 4);
  assert.equal(await readFile(join(root, 'title-events.txt'), 'utf8'), 'start\nend\nstart\nend\n');
  assert.equal(sessions[0].title, 'Сценарист «А» · Проект "А"');
  assert.equal(sessions[1].title, 'Сцены "Б" $() `x` · Другой проект');
  const proof = {
    passed: true,
    checkedAt: new Date().toISOString(),
    pi: pi.version,
    interactiveModeWithNativeProcessTerminal: true,
    simultaneousOwnedPseudoTerminals: true,
    initialAndOngoingTitlesPreserved: true,
    nativeExtensionTitleChangesIntercepted: true,
    exactIdleResumeNoInput: true,
    projectRenameNextOpen: true,
    cyrillicQuotesAndShellCharacters: true,
    localModelRequests: requests,
    externalModelRequests: 0,
    packagedBridge: !!process.env.PI_STUDIO_QA_BRIDGE,
    terminalAppGuiAcceptance: false,
    scope:
      'Real Pi InteractiveMode and native ProcessTerminal in owned captured PTYs. No Terminal.app automation or user data access. GUI title/profile settings remain manual acceptance.',
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/terminal-title-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      sessions.map((session) => ({ title: session.title, output: session.output.slice(-12000) })),
    ),
  );
  throw error;
} finally {
  await host.drain();
  host.close();
  await Promise.all(sessions.map((session) => session.exited));
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
