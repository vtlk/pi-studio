import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { readProjectScope } from '../src/main/storage/projectReadScope.ts';
import { loadOutput } from '../src/main/storage/outputs.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { TeamSupport } from '../src/main/team-mcp/TeamSupport.ts';
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
const received = new Map<string, { messages: unknown[] }>();
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
    received.set(marker, body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (marker === 'CHAT_HELPER_SETTINGS') {
      const readers = tools.filter((name: string) => name.endsWith('read_agent_settings'));
      assert.equal(readers.length, 2, 'Both helper Team and Administration expose profile reads');
      assert.ok(
        !tools.some((name: string) =>
          /mcp__team__.*(?:say_to|read_output|list_output|message_status)/.test(name),
        ),
        'Unbound helper does not advertise project tools',
      );
      const results = body.messages.filter(
        (message: { role: string; tool_call_id?: string }) =>
          message.role === 'tool' && message.tool_call_id?.startsWith('helper-settings-'),
      );
      if (results.length) {
        assert.equal(results.length, 2);
        for (const result of results) {
          const data = JSON.stringify(result.content);
          assert.match(data, /studio-constructor/);
          assert.match(data, /CHAT_HELPER_FRESH_CONTEXT/);
          assert.match(data, /currentConstructor/);
          assert.doesNotMatch(data, /teamRequiresABindingTo|isError.*true/);
        }
      }
      res.write(
        `data: ${JSON.stringify(
          chunk(
            results.length
              ? { role: 'assistant', content: 'SETTINGS_READ_OK' }
              : {
                  role: 'assistant',
                  tool_calls: readers.map((name: string, index: number) => ({
                    index,
                    id: 'helper-settings-' + index,
                    type: 'function',
                    function: {
                      name,
                      arguments: JSON.stringify({ agent_id: helperProfile.id }),
                    },
                  })),
                },
          ),
        )}\n\n`,
      );
      res.end(
        `data: ${JSON.stringify(chunk({}, results.length ? 'stop' : 'tool_calls'))}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
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
        imageInput: true,
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
const helperProfiles = store.bootstrap().sections
  .systemAgents as import('../src/shared/systemAgents.ts').SystemAgent[];
const helperProfile = helperProfiles.find((profile) => profile.systemRole === 'assistant')!;
await store.saveSection(
  'systemAgents',
  helperProfiles.map((profile) =>
    profile.id === helperProfile.id
      ? { ...profile, model: agents[0].model, skills: agents[0].skills }
      : profile,
  ),
);
const helperTeam = new TeamSupport(service);
const helperHost = createSetupAssistant(service, {
  team: helperTeam,
  embedded: true,
  bootstraps: join(root, 'helper-boots'),
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
  const originalRead = store.projects.read.bind(store.projects);
  store.projects.read = async () => {
    throw new Error('Opening Pi must not recursively scan project results');
  };
  const launchStarted = performance.now();
  const launch = host.launch({ ...target(), autoContinue: false });
  await until(() => host.processes().length === 1, 'Child is counted during startup');
  assert.equal(host.chat(target())?.phase, 'opening');
  await launch;
  const firstLaunchMilliseconds = Math.round(performance.now() - launchStarted);
  store.projects.read = originalRead;
  assert.equal(host.chat(target())?.phase, 'ready');
  assert.equal(requests, 0, 'Opening chat sends no model prompt');
  await helperHost.launch({
    projectId: 'pi-setup-assistant',
    agentId: helperProfile.id,
    autoContinue: false,
  });
  const helperTarget = { projectId: 'pi-setup-assistant', agentId: helperProfile.id };
  await helperHost.resetChat({ ...helperTarget, runId: helperHost.chat(helperTarget)!.runId });
  assert.deepEqual(
    helperHost.chat(helperTarget)!.messages,
    [],
    'Never-used helper also resets without an existing state file',
  );
  await helperHost.sendChat({ ...helperTarget, text: 'CHAT_HELPER_OLD' });
  await until(() => waiting.has('CHAT_HELPER_OLD'), 'Helper old response begins');
  release('CHAT_HELPER_OLD');
  await until(
    () => helperHost.inspect(helperTarget.projectId, helperTarget.agentId)?.status !== 'running',
    'Helper settles',
  );
  const helperRoot = join(store.folder, '.pistudio/setup-assistant');
  const helperState = JSON.parse(await readFile(join(helperRoot, 'state.json'), 'utf8'));
  const helperHistory = await readFile(join(helperRoot, helperState.session.path));
  const helperProfilesNow = store.bootstrap().sections.systemAgents as typeof helperProfiles;
  await store.saveSection(
    'systemAgents',
    helperProfilesNow.map((profile) =>
      profile.id === helperProfile.id
        ? { ...profile, mainInstruction: 'CHAT_HELPER_FRESH_CONTEXT' }
        : profile,
    ),
  );
  const helperOldRun = helperHost.chat(helperTarget)!.runId;
  const helperRequests = requests;
  await helperHost.resetChat({ ...helperTarget, runId: helperOldRun });
  assert.equal(requests, helperRequests, 'Reset never sends model input');
  assert.deepEqual(helperHost.chat(helperTarget)!.messages, []);
  assert.equal(
    JSON.parse(await readFile(join(helperRoot, 'state.json'), 'utf8')).session,
    undefined,
  );
  assert.deepEqual(await readFile(join(helperRoot, helperState.session.path)), helperHistory);
  await helperHost.sendChat({ ...helperTarget, text: 'CHAT_HELPER_NEW' });
  await until(() => waiting.has('CHAT_HELPER_NEW'), 'Fresh helper request');
  assert.match(
    JSON.stringify(received.get('CHAT_HELPER_NEW')!.messages),
    /CHAT_HELPER_FRESH_CONTEXT/,
  );
  assert.doesNotMatch(JSON.stringify(received.get('CHAT_HELPER_NEW')!.messages), /CHAT_HELPER_OLD/);
  release('CHAT_HELPER_NEW');
  await until(
    () => helperHost.inspect(helperTarget.projectId, helperTarget.agentId)?.status !== 'running',
    'Fresh helper settles',
  );
  const newHelperState = JSON.parse(await readFile(join(helperRoot, 'state.json'), 'utf8'));
  assert.notEqual(newHelperState.session.id, helperState.session.id);
  await helperHost.sendChat({ ...helperTarget, text: 'CHAT_HELPER_SETTINGS' });
  await until(
    () =>
      helperHost
        .chat(helperTarget)
        ?.messages.some((message) =>
          message.parts.some((part) => part.text?.includes('SETTINGS_READ_OK')),
        ) && helperHost.inspect(helperTarget.projectId, helperTarget.agentId)?.status !== 'running',
    'Helper reads full settings through both real native MCP transports without an open project',
  );
  const helperRequestsAtClose = requests;
  const helperPid = helperHost.processes()[0].pid;
  await helperHost.drain();
  await helperHost.close();
  assert.equal(helperHost.processes().length, 0, 'Helper process is gone before quit completes');
  assert.throws(() => process.kill(helperPid, 0), { code: 'ESRCH' });
  assert.equal(
    requests,
    helperRequestsAtClose,
    'Helper shutdown never sends another model message',
  );
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
  assert.throws(() => host.updates.assertIdle(), undefined, 'Running chat defers an update');
  await host.launch({ ...target('b'), autoContinue: false });
  await host.sendChat({ ...target('b'), text: 'CHAT_B1: Reply once.' });
  await until(() => waiting.has('CHAT_B1'), 'Second agent works concurrently');
  assert.equal(host.processes().length, 2);
  const previewPath = project.agents[1].outputPath + '/parallel-preview.txt';
  await writeFile(
    join(await store.projects.directory(project.id), previewPath),
    'PARALLEL_PREVIEW',
  );
  let releaseStore!: () => void;
  const blockedStore = service.serialize(
    () =>
      new Promise<void>((resolve) => {
        releaseStore = resolve;
      }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    const view = await Promise.race([
      readProjectScope(service, project.id, (_store, root) => loadOutput(root, previewPath)),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(Error('Preview waited for another agent')), 2000);
        timer.unref();
      }),
    ]);
    assert.equal(view.content, 'PARALLEL_PREVIEW');
    await Promise.race([
      host.launch({ ...target(), autoContinue: false }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(Error('Live chat waited for another agent')), 2000);
        timer.unref();
      }),
    ]);
    assert.equal(host.chat(target())?.working, true);
  } finally {
    releaseStore();
    await blockedStore;
  }
  await host.launch({ ...target(), autoContinue: false });
  assert.equal(
    host.processes().find((process) => process.agentId === 'a')?.pid,
    pid,
    'Working process also reused',
  );
  await host.sendChat({ ...target(), text: 'CHAT_A2: Follow up.', behavior: 'followUp' });
  await host.sendChat({
    ...target(),
    text: 'CHAT_STEER: Change the current task.',
    behavior: 'steer',
  });
  await until(
    () =>
      host.chat(target())?.queue?.steering.includes('CHAT_STEER: Change the current task.') &&
      host.chat(target())?.queue?.followUp.includes('CHAT_A2: Follow up.'),
    'Native queue_update exposes accepted steer and follow-up immediately',
  );
  assert.equal(
    host
      .chat(target())
      ?.messages.some(
        (message) =>
          message.role === 'user' &&
          message.parts.some((part) => part.text?.includes('CHAT_STEER')),
      ),
    false,
    'Queued input is not synthetic history',
  );
  await host.launch({ ...target(), autoContinue: false });
  assert.equal(
    host.chat(target())?.queue?.steering.length,
    1,
    'Reopening the existing process preserves its native queue',
  );
  const queuedItem = (marker: string) =>
    host.chat(target())?.queue?.items?.find((item) => item.text.includes(marker));
  await host.sendChat({
    ...target(),
    text: 'CHAT_PROMOTE: Interrupt after current tools.',
    behavior: 'followUp',
  });
  await host.sendChat({
    ...target(),
    text: 'CHAT_DELETE_QUEUE: Never deliver.',
    behavior: 'followUp',
  });
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yMksAAAAASUVORK5CYII=',
    'base64',
  );
  const queuedImage = await references.paste(pixel, join(root, 'queue-images'), store.folder);
  await host.sendChat({
    ...target(),
    text: 'CHAT_EDIT_QUEUE: Restore this image input.',
    attachments: [queuedImage.id],
    behavior: 'followUp',
  });
  await host.sendChat({ ...target(), text: 'CHAT_DUPLICATE', behavior: 'followUp' });
  await host.sendChat({ ...target(), text: 'CHAT_DUPLICATE', behavior: 'followUp' });
  await until(
    () =>
      host.chat(target())?.queue?.items?.filter((item) => item.text === 'CHAT_DUPLICATE').length ===
        2 && queuedItem('CHAT_EDIT_QUEUE'),
    'Native queue stable IDs include identical inputs and images',
  );
  const sequenceBeforeQueueActions = host.inspect(project.id, 'a')!.sequence;
  const changeQueue = (entryId: string, action: 'steer' | 'delete' | 'edit') =>
    host.changeChatQueue(
      { ...target(), runId: host.chat(target())!.runId, entryId, action },
      async (data) => {
        assert.ok(data.images?.[0]);
        assert.equal(data.images[0].data, pixel.toString('base64'));
        return { text: data.text };
      },
    );
  const promotedId = queuedItem('CHAT_PROMOTE')!.id;
  await changeQueue(promotedId, 'steer');
  await until(
    () => queuedItem('CHAT_PROMOTE')?.kind === 'steering',
    'Follow-up becomes native steering without requeueing neighbors',
  );
  await changeQueue(queuedItem('CHAT_DELETE_QUEUE')!.id, 'delete');
  const edited = await changeQueue(queuedItem('CHAT_EDIT_QUEUE')!.id, 'edit');
  assert.match(edited.text!, /CHAT_EDIT_QUEUE/);
  const duplicates = host
    .chat(target())!
    .queue!.items!.filter((item) => item.text === 'CHAT_DUPLICATE');
  assert.notEqual(duplicates[0].id, duplicates[1].id);
  await changeQueue(duplicates[1].id, 'delete');
  await assert.rejects(changeQueue(duplicates[1].id, 'delete'), /queue|очеред/i);
  assert.equal(
    host.chat(target())!.queue!.items!.filter((item) => item.text === 'CHAT_DUPLICATE').length,
    1,
  );
  await changeQueue(duplicates[0].id, 'delete');
  assert.equal(
    host.inspect(project.id, 'a')!.sequence,
    sequenceBeforeQueueActions,
    'Queue controls do not run input handlers or create new task sequences',
  );
  release('CHAT_A1');
  await until(() => waiting.has('CHAT_STEER'), 'Steer is consumed before follow-up');
  assert.equal(host.chat(target())?.queue?.steering.length, 1);
  assert.equal(host.chat(target())?.queue?.followUp.length, 1);
  assert.equal(
    host
      .chat(target())
      ?.messages.filter(
        (message) =>
          message.role === 'user' &&
          message.parts.some((part) => part.text?.includes('CHAT_STEER')),
      ).length,
    1,
    'Steer enters actual history exactly once',
  );
  release('CHAT_STEER');
  await until(() => waiting.has('CHAT_PROMOTE'), 'Promoted steering is delivered before follow-up');
  release('CHAT_PROMOTE');
  await until(() => waiting.has('CHAT_A2'), 'Queued follow-up starts');
  release('CHAT_A2');
  release('CHAT_B1');
  await until(
    () => !host.chat(target())?.working && !host.chat(target('b'))?.working,
    'Both requests settle',
  );
  assert.ok(
    !received.has('CHAT_DELETE_QUEUE') &&
      !received.has('CHAT_EDIT_QUEUE') &&
      !received.has('CHAT_DUPLICATE'),
    'Deleted/edited native inputs never reached the model',
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
  await until(() => {
    try {
      host.updates.assertIdle();
      return true;
    } catch {
      return false;
    }
  }, 'Idle SDK chats permit the update after lifecycle persistence');
  const currentOldHistory = await readFile(path);
  const otherPid = host.processes().find((item) => item.agentId === 'b')!.pid;
  const currentProfiles = store.bootstrap().sections.agents as Agent[];
  await store.saveSection(
    'agents',
    currentProfiles.map((profile) =>
      profile.id === 'a'
        ? {
            ...profile,
            mainInstruction: 'CHAT_PROJECT_FRESH_PROMPT',
            instructions: [
              {
                id: 'new-instruction',
                name: 'Updated instruction',
                content: 'CHAT_PROJECT_FRESH_INSTRUCTION',
                enabled: true,
              },
            ],
          }
        : profile,
    ),
  );
  const requestsBeforeReset = requests;
  await host.resetChat({ ...target(), runId: host.chat(target())!.runId });
  assert.equal(requests, requestsBeforeReset, 'Fresh project chat opens without model input');
  assert.deepEqual(host.chat(target())!.messages, []);
  assert.equal(
    host.processes().find((item) => item.agentId === 'b')!.pid,
    otherPid,
    'Other process untouched',
  );
  assert.equal(store.projects.snapshot(project.id).agents[0].session, undefined);
  assert.deepEqual(await readFile(path), currentOldHistory, 'Previous JSONL stays byte exact');
  await host.sendChat({ ...target(), text: 'CHAT_PROJECT_NEW' });
  await until(() => waiting.has('CHAT_PROJECT_NEW'), 'Fresh project request begins');
  const freshContext = JSON.stringify(received.get('CHAT_PROJECT_NEW')!.messages);
  assert.match(freshContext, /CHAT_PROJECT_FRESH_PROMPT/);
  assert.match(freshContext, /CHAT_PROJECT_FRESH_INSTRUCTION/);
  assert.ok(
    freshContext.includes(await store.projects.directory(project.id)),
    'Fresh context contains project path',
  );
  assert.doesNotMatch(freshContext, /CHAT_A1|CHAT_A2|CHAT_TOOL_OK/);
  release('CHAT_PROJECT_NEW');
  await until(
    () => host.inspect(project.id, 'a')?.status !== 'running',
    'Fresh project response settles',
  );
  const freshBinding = store.projects.snapshot(project.id).agents[0].session!;
  assert.notEqual(freshBinding.id, binding.id);
  assert.notEqual(freshBinding.path, binding.path);
  await until(() => {
    try {
      host.updates.assertIdle();
      return true;
    } catch {
      return false;
    }
  }, 'Fresh request fully settles in both native SDK and Studio before update admission');
  const historyBeforeUpdate = await readFile(path);
  const lease = host.updates.hold();
  await assert.rejects(host.sendChat({ ...target(), text: 'CHAT_MUST_NOT_START' }));
  await lease.drainIdle();
  assert.equal(host.processes().length, 0, 'Update closes only the owned idle SDK processes');
  assert.deepEqual(
    await readFile(path),
    historyBeforeUpdate,
    'Idle update shutdown preserves exact JSONL',
  );
  lease.verify();
  lease.release();
  assert.ok(!fixtureError);
  console.log(
    JSON.stringify(
      {
        ok: true,
        version: pi.version,
        firstLaunchMilliseconds,
        timingScope: 'isolated Mac fixture, not the user Windows machine or installed Mac profile',
        scope: 'isolated native SDK + local model fixture; no external LLM/desktop permissions',
        checks: [
          'startup count/spinner state',
          'cold launch does not scan project outputs; one shared Pi check and native auth/catalog preflight',
          'idle/working process reuse',
          'parallel agents',
          'file preview and busy chat reopen complete while studio persistence is deliberately held',
          'streaming',
          'authoritative steer/follow-up queue visible before delivery and retained on reopen',
          'steer delivered before follow-up, exactly once in native history',
          'native per-entry steer/edit/delete preserves duplicate identities and image bytes without input-hook replay; stale IDs never remove a neighbor',
          'exact session restore and JSONL bytes',
          'clear project/helper chat: new native session, fresh prompt/instructions/skills/MCP, no automatic message, previous JSONL unchanged',
          'helper reads full constructor settings through both Team and Administration native MCP without selecting a production project',
          'selected model/Skill/Project MCP',
          'extension UI round-trip',
          'tool calls/results',
          'abort without exit',
          'per-message attachments preserve source files',
          'process exit count',
          'setup assistant native RPC process closes and is awaited before quit; no model input',
          'update waits for busy chats and drains owned idle processes',
          'update shutdown preserves exact JSONL and blocks new input',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const res of waiting.values()) res.destroy();
  await host.drain();
  await host.close();
  await helperHost.drain();
  await helperHost.close();
  helperTeam.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
