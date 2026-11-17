import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { Agent } from '../src/shared/studio.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-chat-sdk-'));
const native = join(root, 'Native');
await mkdir(join(native, 'extensions'), { recursive: true });
process.env.PI_CODING_AGENT_DIR = native;
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
await writeFile(
  join(native, 'extensions/chat.js'),
  `export default function(pi){
  pi.registerTool({name:'chat_probe',label:'QA chat tool',description:'Returns owned fixture text',parameters:{type:'object',properties:{}},
    async execute(){return {content:[{type:'text',text:'CHAT_TOOL_OK'}],details:{}};}});
  pi.registerCommand('qa-dialog',{description:'Owned UI fixture',handler:async(args,ctx)=>{
    const value=await ctx.ui.input('QA extension input','QA placeholder'); ctx.ui.notify('ANSWER:'+value,'info');
  }});
}`,
);
const waiting = new Map<string, ServerResponse>();
let requests = 0,
  fixtureError: unknown;
const chunk = (content: unknown, finish_reason: string | null = null) => ({
  id: 'chat-fixture',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'qa-chat',
  choices: [{ index: 0, delta: content, finish_reason }],
});
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const data of req) chunks.push(Buffer.from(data));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests++;
    assert.equal(req.headers.authorization, undefined);
    assert.equal(body.model, 'qa-chat');
    const tools = body.tools.map((tool: { function: { name: string } }) => tool.function.name);
    assert.ok(tools.includes('chat_probe'));
    assert.ok(
      tools.some((name: string) => name.endsWith('get_run_context')),
      'Assigned Project MCP survives embedded mode',
    );
    assert.match(
      JSON.stringify(body.messages),
      /chat-fixture-skill/,
      'Assigned Skill survives embedded mode',
    );
    const text = JSON.stringify(
      body.messages.filter((message: { role: string }) => message.role === 'user').at(-1).content,
    );
    const marker = text.match(/CHAT_[A-Z0-9_]+/)?.[0] ?? 'UNKNOWN';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (marker === 'CHAT_TOOL') {
      const toolResult = body.messages.at(-1).role === 'tool';
      res.write(
        `data: ${JSON.stringify(
          chunk(
            toolResult
              ? { role: 'assistant', content: 'Tool completed.' }
              : {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'chat-tool',
                      type: 'function',
                      function: { name: 'chat_probe', arguments: '{}' },
                    },
                  ],
                },
          ),
        )}\n\n`,
      );
      res.end(
        `data: ${JSON.stringify(chunk({}, toolResult ? 'stop' : 'tool_calls'))}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
    assert.ok(!waiting.has(marker), 'No duplicated model requests');
    res.write(
      `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Streaming ' + marker }))}\n\n`,
    );
    waiting.set(marker, res);
    res.once('close', () => {
      if (waiting.get(marker) === res) waiting.delete(marker);
    });
  } catch (error) {
    fixtureError = error;
    res.statusCode = 500;
    res.end('Fixture rejected');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  pi = await checkPi('');
const connection = {
  id: 'qa-chat',
  name: 'Local chat fixture',
  purpose: 'local' as const,
  providerId: endpointProviderId('qa-chat'),
  authScope: 'connection' as const,
  endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  account: '',
  createdAt: 1,
  endpointConfig: {
    api: 'openai-completions' as const,
    auth: 'none' as const,
    models: [
      {
        id: 'qa-chat',
        name: 'QA chat',
        imageInput: false,
        reasoning: false,
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  },
};
await store.saveSection('connections', [connection]);
const skill = join(root, 'skill');
await mkdir(skill);
await writeFile(
  join(skill, 'SKILL.md'),
  '---\nname: chat-fixture-skill\ndescription: Isolated chat fixture skill\n---\nCHAT_SKILL_TEXT\n',
);
await store.saveSection('resources', [
  {
    id: 'chat-skill',
    name: 'chat-fixture-skill',
    kind: 'skills',
    source: skill,
    localSkill: true,
    version: '',
    description: 'QA',
    transport: '',
    args: '',
    credential: '',
    contents: '',
    createdAt: 1,
  },
]);
const agents: Agent[] = ['a', 'b'].map((id) => ({
  id,
  name: 'Chat ' + id,
  enabled: true,
  instructions: [],
  skills: ['chat-skill'],
  mcps: [],
  plugins: [],
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-chat',
    reasoning: 'По умолчанию',
    temperature: '',
  },
}));
await store.saveSection('agents', agents);
const project = (await store.command({ kind: 'create', name: 'Chat SDK QA', agents })).projects[0];
const references = new ReferenceFiles();
const host = createStudioRunHost(service, {
  references,
  embedded: true,
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
});
const target = (agentId = 'a') => ({ projectId: project.id, agentId });
const until = async (check: () => unknown, label: string) => {
  const end = Date.now() + 15000;
  while (!check() && Date.now() < end) {
    if (fixtureError) throw fixtureError;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(check(), label);
};
const release = (marker: string) => {
  const res = waiting.get(marker);
  assert.ok(res, marker);
  res.end(
    `data: ${JSON.stringify(chunk({ content: ' DONE' }))}\n\ndata: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`,
  );
};
try {
  const launch = host.launch({ ...target(), autoContinue: false });
  await until(() => host.processes().length === 1, 'Child is counted during startup');
  assert.equal(host.chat(target())?.phase, 'opening');
  await launch;
  assert.equal(host.chat(target())?.phase, 'ready');
  assert.equal(requests, 0, 'Opening chat sends no model prompt');
  const pid = host.processes()[0].pid;
  await host.launch({ ...target(), autoContinue: false });
  assert.equal(host.processes()[0].pid, pid, 'Reopening chat reuses the same idle process');
  const inputFile = join(root, 'chat-reference.txt');
  await writeFile(inputFile, 'CHAT_INPUT_UNCHANGED');
  const selected = await references.select([inputFile], store.folder);
  await host.sendChat({
    ...target(),
    text: 'CHAT_A1: Reply once.',
    attachments: selected.map((file) => file.id),
  });
  assert.equal(await readFile(inputFile, 'utf8'), 'CHAT_INPUT_UNCHANGED');
  await until(
    () =>
      host
        .chat(target())
        ?.messages.some((message) =>
          message.parts.some((part) => part.text?.includes('Streaming CHAT_A1')),
        ),
    'Live streamed text reaches chat',
  );
  assert.equal(host.chat(target())?.working, true);
  await host.launch({ ...target('b'), autoContinue: false });
  await host.sendChat({ ...target('b'), text: 'CHAT_B1: Reply once.' });
  await until(() => waiting.has('CHAT_B1'), 'Second agent works concurrently');
  assert.equal(host.processes().length, 2);
  await host.launch({ ...target(), autoContinue: false });
  assert.equal(
    host.processes().find((process) => process.agentId === 'a')?.pid,
    pid,
    'Working process also reused',
  );
  await host.sendChat({ ...target(), text: 'CHAT_A2: Follow up.', behavior: 'followUp' });
  release('CHAT_A1');
  await until(() => waiting.has('CHAT_A2'), 'Queued follow-up starts');
  release('CHAT_A2');
  release('CHAT_B1');
  await until(
    () => !host.chat(target())?.working && !host.chat(target('b'))?.working,
    'Both requests settle',
  );
  const saved = await store.projects.read(project.id),
    binding = saved.agents[0].session!;
  assert.ok(binding);
  const path = join(await store.projects.directory(project.id), binding.path);
  const before = await readFile(path);
  assert.match(before.toString(), /CHAT_A1/);
  assert.match(before.toString(), /CHAT_A2/);
  await host.stopAgent(project.id, 'a');
  assert.equal(host.processes().length, 1, 'Count follows actual exits');
  await host.launch({ ...target(), autoContinue: false });
  assert.equal((await store.projects.read(project.id)).agents[0].session?.id, binding.id);
  assert.deepEqual(
    await readFile(path),
    before,
    'Resume without a prompt preserves exact JSONL bytes',
  );
  assert.ok(
    host
      .chat(target())
      ?.messages.some((message) => message.parts.some((part) => part.text?.includes('CHAT_A1'))),
  );
  const input = host.sendChat({ ...target(), text: '/qa-dialog' });
  await until(() => host.chat(target())?.dialog, 'Extension input is shown in app');
  host.answerChat({ ...target(), id: host.chat(target())!.dialog!.id, value: 'CHAT_UI_OK' });
  await input;
  await until(
    () => host.chat(target())?.notification?.includes('ANSWER:CHAT_UI_OK'),
    'UI answer returns to native extension',
  );
  await host.sendChat({ ...target(), text: 'CHAT_TOOL: Use the fixture tool.' });
  await until(
    () =>
      !host.chat(target())?.working &&
      host
        .chat(target())
        ?.messages.some(
          (message) =>
            message.role === 'toolResult' &&
            message.parts.some((part) => part.text?.includes('CHAT_TOOL_OK')),
        ),
    'Tool calls/results survive RPC',
  );
  await host.sendChat({ ...target(), text: 'CHAT_ABORT: Wait.' });
  await until(() => waiting.has('CHAT_ABORT'), 'Abort fixture starts');
  await host.abortChat(target());
  await until(() => !host.chat(target())?.working, 'Abort settles without closing process');
  assert.equal(host.processes().length, 2);
  assert.ok(!fixtureError);
  console.log(
    JSON.stringify(
      {
        ok: true,
        version: pi.version,
        scope: 'isolated native SDK + local model fixture; no external LLM/desktop permissions',
        checks: [
          'startup count/spinner state',
          'idle/working process reuse',
          'parallel agents',
          'streaming',
          'follow-up queue',
          'exact session restore and JSONL bytes',
          'selected model/Skill/Project MCP',
          'extension UI round-trip',
          'tool calls/results',
          'abort without exit',
          'per-message attachments preserve source files',
          'process exit count',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const res of waiting.values()) res.destroy();
  await host.drain();
  host.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
