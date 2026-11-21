/** Real Pi SDK + production chain/MCP with a local synthetic model; never opens Terminal or a user studio. */
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { TeamSupport } from '../src/main/team-mcp/TeamSupport.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { teamMcpId } from '../src/shared/builtinResources.ts';
import { endpointProviderId } from '../src/shared/modelEndpoint.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SessionBinding } from '../src/shared/project.ts';

const root = await mkdtemp(join(tmpdir(), 'pistudio-chain-reuse-'));
process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
await mkdir(process.env.PI_CODING_AGENT_DIR);
const pi = await checkPi('');
assert.ok(pi.supported);
const testCorrections = process.argv.includes('--correction');
const testReconnect = process.argv.includes('--codex-reconnect');
const codexModel = 'gpt-6-sol';
const codexFixture = new URL('./fixtures/codex-loopback.mjs', import.meta.url);
const codex = testReconnect ? await import(codexFixture.href) : undefined;
if (testReconnect) {
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'qa-account' } }),
  ).toString('base64url');
  await writeFile(
    join(process.env.PI_CODING_AGENT_DIR, 'auth.json'),
    JSON.stringify({
      'openai-codex': {
        type: 'oauth',
        access: `qa.${payload}.qa`,
        refresh: 'qa-refresh',
        expires: Date.now() + 3_600_000,
      },
    }),
    { mode: 0o600 },
  );
  process.env.NODE_OPTIONS = `--import=${codexFixture.href}`;
}
const reports: unknown[] = [];
try {
  const modes = testReconnect
    ? (['correction-closed'] as const)
    : testCorrections
      ? (['correction-closed', 'correction-idle'] as const)
      : (['idle', 'busy'] as const);
  for (const mode of modes) {
    const correction = mode === 'correction-closed' || mode === 'correction-idle';
    let host: ReturnType<typeof createStudioRunHost>;
    let failure: unknown,
      requests = 0,
      busyResponse: ServerResponse | undefined,
      releaseSource: (() => void) | undefined,
      releaseCorrectionRequest: (() => void) | undefined,
      releaseCorrectedOutput: (() => void) | undefined,
      correctionPid: number | undefined,
      disconnects = 0;
    const steps = new Map<string, number>();
    const autoPidChecks: { agentId: string; pid: number }[] = [];
    const expectedPids = new Map<string, number>();
    const notices: { agentId: string; failure: unknown }[] = [];
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({
      id: 'chain-reuse',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qa-chain',
      choices: [{ index: 0, delta, finish_reason }],
    });
    const end = (response: ServerResponse, tool: boolean) =>
      response.end(
        `data: ${JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`,
      );
    const server = createServer(async (request, response) => {
      try {
        const fromCodex = testReconnect && request.url === '/codex';
        if (fromCodex) {
          assert.equal(request.headers['chatgpt-account-id'], 'qa-account');
          assert.match(request.headers.authorization ?? '', /^Bearer qa\.[A-Za-z0-9_-]+\.qa$/);
        } else {
          assert.equal(request.url, '/v1/chat/completions');
          assert.equal(request.headers.authorization, undefined);
        }
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(Buffer.from(part));
        const payload = Buffer.concat(parts);
        const body = JSON.parse(
          (request.headers['content-encoding'] === 'zstd'
            ? zstdDecompressSync(payload)
            : payload
          ).toString(),
        );
        assert.equal(body.model, fromCodex ? codexModel : 'qa-chain');
        requests++;
        const system = fromCodex
          ? body.instructions
          : JSON.stringify(body.messages.filter((m: { role: string }) => m.role === 'system'));
        const stage = system.match(/QA_CHAIN_STAGE:(first|next|last)/)?.[1];
        assert.ok(stage);
        const lastUser = JSON.stringify(
          (fromCodex ? body.input : body.messages).findLast(
            (m: { role: string }) => m.role === 'user',
          ).content,
        );
        const revising = lastUser.includes('QA_BACKWARD_CORRECTION');
        if (fromCodex && revising && steps.get('revision') === 1 && disconnects < 4) {
          disconnects++;
          assert.equal(
            host.processes().find((item) => item.agentId === 'first')?.pid,
            correctionPid,
          );
          assert.equal(host.inspect(project.id, 'next')?.status, 'running');
          assert.equal(steps.get('next'), 1);
          assert.ok(body.input.some((m: { type: string }) => m.type === 'function_call_output'));
          response.writeHead(200, { 'x-qa-connect-timeout': '1' }).end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (lastUser.includes('PRIOR_HISTORY_')) {
          response.write(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'PRIOR_ANSWER_' + stage }))}\n\n`,
          );
          end(response, false);
          return;
        }
        if (lastUser.includes('QA_CHAIN_QUESTION')) {
          assert.equal(stage, 'first');
          response.write(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Which input should I use?' }))}\n\n`,
          );
          end(response, false);
          return;
        }
        if (lastUser.includes('BUSY_MANUAL_TASK')) {
          assert.equal(stage, 'next');
          assert.equal(mode, 'busy');
          assert.equal(busyResponse, undefined);
          response.write(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'BUSY_TASK_STARTED' }))}\n\n`,
          );
          busyResponse = response;
          return;
        }
        assert.ok(
          lastUser.includes('CHAIN_CURRENT_TASK') || (correction && revising && stage === 'first'),
        );
        if (expectedPids.has(stage)) {
          const actual = host.processes().find((p) => p.agentId === stage)!;
          assert.equal(actual.pid, expectedPids.get(stage));
          autoPidChecks.push({ agentId: stage, pid: actual.pid });
        }
        assert.ok(
          mode !== 'busy' || stage === 'first',
          'Busy next agent must never receive the automatic message',
        );
        const key = revising ? 'revision' : stage;
        const step = steps.get(key) ?? 0;
        steps.set(key, step + 1);
        const askingForCorrection = correction && stage === 'next';
        const outputStep = step - Number(askingForCorrection);
        assert.ok(outputStep < 3, 'No duplicate generation/task');
        const tools = fromCodex
          ? [
              ...body.tools,
              ...body.input.flatMap((item: { tools?: unknown[] }) => item.tools ?? []),
            ]
          : body.tools.map((t: { function: { name: string } }) => t.function);
        const tool =
          outputStep === -1
            ? tools.find((t: { name?: string }) => t.name?.endsWith('__say_to'))
            : outputStep === 0
              ? tools.find((t: { name: string }) => t.name === 'write')
              : outputStep === 1
                ? tools.find((t: { name?: string }) => t.name?.endsWith('complete_stage'))
                : undefined;
        if (outputStep < 2)
          assert.ok(
            tool,
            `Expected tool for ${key}/${outputStep}; received ${JSON.stringify(
              tools.map((t: { name?: string; type?: string; tools?: { name: string }[] }) => ({
                name: t.name,
                type: t.type,
                children: t.tools?.map((child) => child.name),
              })),
            )}`,
          );
        const args =
          outputStep === -1
            ? {
                agent_id: 'first',
                request_id: 'backward-correction',
                text: 'QA_BACKWARD_CORRECTION',
              }
            : outputStep === 0
              ? {
                  path: 'output/result.txt',
                  content: revising ? 'REVISED_RESULT' : 'RESULT_' + stage,
                }
              : { outputs: ['result.txt'] };
        if (revising && correctionPid)
          assert.equal(
            host.processes().find((item) => item.agentId === 'first')?.pid,
            correctionPid,
          );
        if (askingForCorrection && step === 1)
          assert.match(
            JSON.stringify(body.messages.filter((m: { role: string }) => m.role === 'tool')),
            /state\\?"\s*:\s*\\?"completed/,
          );
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: key + '-' + step,
                  type: 'function',
                  function: { name: tool.name, arguments: JSON.stringify(args) },
                },
              ],
            }
          : { role: 'assistant', content: 'CHAIN_FINISHED_' + stage };
        const respond = () => {
          if (fromCodex)
            codex!.codexResponse(
              response,
              key + step,
              tool,
              args,
              'CHAIN_FINISHED_' + stage,
              codexModel,
            );
          else {
            response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
            end(response, !!tool);
          }
        };
        if (revising && step === 0) releaseCorrectedOutput = respond;
        else if (askingForCorrection && step === 0) releaseCorrectionRequest = respond;
        else if (stage === 'first' && step === 0) releaseSource = respond;
        else respond();
      } catch (error) {
        failure = error;
        response.end('QA rejected request');
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    if (testReconnect)
      process.env.PI_STUDIO_QA_CODEX_ORIGIN = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const service = new StudioService(
      join(root, mode, 'preferences.json'),
      join(root, mode, 'Studio'),
    );
    const store = await service.load();
    const connection = {
      id: 'qa-chain',
      name: 'Local fixture',
      purpose: 'local' as const,
      providerId: endpointProviderId('qa-chain'),
      authScope: 'connection' as const,
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      account: '',
      createdAt: 1,
      endpointConfig: {
        api: 'openai-completions' as const,
        auth: 'none' as const,
        models: [
          {
            id: 'qa-chain',
            name: 'QA',
            imageInput: false,
            reasoning: false,
            contextWindow: 32000,
            maxTokens: 1024,
          },
        ],
      },
    };
    const codexConnection = {
      id: 'qa-codex',
      name: 'Local Codex fixture',
      purpose: 'codex',
      providerId: 'openai-codex',
      endpoint: '',
      account: '',
      createdAt: 1,
    };
    await store.saveSection(
      'connections',
      testReconnect ? [connection, codexConnection] : [connection],
    );
    const agents: Agent[] = ['first', 'next', 'last'].map((id) => ({
      id,
      name: id,
      enabled: true,
      mainInstruction: 'QA_CHAIN_STAGE:' + id,
      instructions: [],
      skills: [],
      mcps: correction ? [teamMcpId] : [],
      plugins: [],
      model: {
        connectionId: testReconnect && id === 'first' ? codexConnection.id : connection.id,
        provider:
          testReconnect && id === 'first' ? codexConnection.providerId : connection.providerId,
        id: testReconnect && id === 'first' ? codexModel : 'qa-chain',
        reasoning: testReconnect && id === 'first' ? 'По умолчанию' : 'off',
        temperature: '',
      },
    }));
    await store.saveSection('agentCatalog', {
      agents,
      teams: [{ id: 'qa-team', name: 'QA', agentIds: agents.map((a) => a.id) }],
    });
    const project = (
      await store.command({
        kind: 'create',
        name: 'Reuse ' + mode,
        teamId: 'qa-team',
        agents: store.teamProfiles('qa-team'),
      })
    ).projects[0];
    const team = correction ? new TeamSupport(service) : undefined;
    host = createStudioRunHost(service, {
      team,
      embedded: true,
      bootstraps: join(root, mode, 'boots'),
      bridge: fileURLToPath(new URL('../bundled/pi-bridge/session.mjs', import.meta.url)),
      catalog: fileURLToPath(new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url)),
      piPath: () => pi.path,
      failureChanged: (run, failure) => {
        if (failure) notices.push({ agentId: run.agent.profile.id, failure });
      },
    });
    const target = (agentId: string) => ({ projectId: project.id, agentId });
    const until = async (check: () => unknown, label: string) => {
      const limit = Date.now() + 60000;
      while (!check() && Date.now() < limit) {
        if (failure) throw failure;
        await new Promise((done) => setTimeout(done, 25));
      }
      if (failure) throw failure;
      assert.ok(
        check(),
        `${label} (model steps: ${JSON.stringify([...steps])}; run notices: ${JSON.stringify(notices)})`,
      );
    };
    const prior = new Map<string, { binding: SessionBinding; bytes: Buffer; runId: string }>();
    try {
      for (const id of correction ? [] : mode === 'idle' ? ['next', 'last'] : ['next']) {
        const opened = await host.launch({ ...target(id), autoContinue: false });
        expectedPids.set(id, host.processes().find((p) => p.agentId === id)!.pid);
        await host.sendChat({ ...target(id), text: 'PRIOR_HISTORY_' + id });
        await until(
          () =>
            host.inspect(project.id, id)?.status === 'waiting' && !host.chat(target(id))?.working,
          'Manual prior conversation settled',
        );
        const item = (await store.projects.read(project.id)).agents.find(
          (a) => a.profile.id === id,
        )!;
        assert.ok(item.session);
        prior.set(id, {
          binding: { ...item.session },
          bytes: await readFile(
            join(await store.projects.directory(project.id), item.session.path),
          ),
          runId: opened.runId,
        });
      }
      if (mode === 'busy') {
        await host.sendChat({ ...target('next'), text: 'BUSY_MANUAL_TASK' });
        await until(
          () => !!busyResponse && host.chat(target('next'))?.working,
          'Manual recipient task is working',
        );
      }
      const first = await host.launch({ ...target('first'), autoContinue: false });
      if (mode === 'idle') {
        await host.sendChat({ ...target('first'), text: 'QA_CHAIN_QUESTION' });
        await until(
          () =>
            host.inspect(project.id, 'first')?.status === 'waiting' &&
            host
              .chat(target('first'))
              ?.messages.some((message) =>
                message.parts.some((part) => part.text?.includes('Which input should I use?')),
              ) &&
            !host.chat(target('first'))?.working,
          'The agent has asked a question and is waiting for the user',
        );
      }
      await host.sendChat({ ...target('first'), text: 'CHAIN_CURRENT_TASK' });
      await until(
        () => releaseSource && host.inspect(project.id, 'first')?.status === 'running',
        'The current request is already in flight at the model',
      );
      const pid = host.processes().find(({ agentId }) => agentId === 'first')!.pid;
      const requestsBeforeArm = requests;
      if (mode !== 'busy') host.setAutoContinuation({ ...target('first'), enabled: true });
      else
        assert.equal(
          (await host.launch({ ...target('first'), autoContinue: true })).runId,
          first.runId,
        );
      assert.equal(host.processes().find(({ agentId }) => agentId === 'first')!.pid, pid);
      assert.equal(requests, requestsBeforeArm, 'Arming never sends another model request');
      releaseSource!();
      releaseSource = undefined;
      if (correction) {
        await until(
          () => releaseCorrectionRequest,
          'QA is ready to send a real native Team request',
        );
        assert.equal(
          host.processes().some((item) => item.agentId === 'first'),
          false,
        );
        const directory = await store.projects.directory(project.id);
        const original = store.projects.snapshot(project.id).agents[0];
        assert.ok(original.session);
        const sessionPath = join(directory, original.session.path);
        const originalBytes = await readFile(sessionPath);
        if (mode === 'correction-idle') {
          await host.launch({ ...target('first'), autoContinue: false });
          correctionPid = host.processes().find((item) => item.agentId === 'first')!.pid;
        }
        const qaPid = host.processes().find((item) => item.agentId === 'next')!.pid;
        releaseCorrectionRequest!();
        releaseCorrectionRequest = undefined;
        await until(() => releaseCorrectedOutput, 'Earlier stage received the correction');
        if (testReconnect)
          correctionPid = host.processes().find((item) => item.agentId === 'first')!.pid;
        assert.equal(host.inspect(project.id, 'next')?.status, 'running');
        assert.equal(steps.get('next'), 1, 'QA waits inside say_to');
        assert.equal(steps.has('last'), false);
        releaseCorrectedOutput!();
        releaseCorrectedOutput = undefined;
        await until(
          () =>
            store.projects.snapshot(project.id).agents[2].runStatus === 'ready' &&
            !host.processes().some((item) => item.agentId === 'last'),
          'The original QA step finished and advanced to the final stage',
        );
        assert.deepEqual(
          [...steps],
          [
            ['first', 3],
            ['next', 4],
            ['revision', 3],
            ['last', 3],
          ],
        );
        assert.deepEqual(notices, []);
        assert.equal(
          await readFile(join(directory, original.outputPath, 'result.txt'), 'utf8'),
          'REVISED_RESULT',
        );
        assert.equal(
          store.projects.snapshot(project.id).agents[0].session?.id,
          original.session.id,
        );
        const finalBytes = await readFile(sessionPath);
        assert.ok(finalBytes.subarray(0, originalBytes.length).equals(originalBytes));
        if (testReconnect) {
          assert.equal(disconnects, 4);
          const entries = finalBytes
            .toString()
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          const correctionEntries = entries.filter(
            (entry) =>
              entry.type === 'message' &&
              entry.message.role === 'user' &&
              JSON.stringify(entry.message.content).includes('QA_BACKWARD_CORRECTION'),
          );
          assert.equal(correctionEntries.length, 1);
          const writes = entries.filter(
            (entry) =>
              entry.type === 'message' &&
              entry.message.role === 'toolResult' &&
              entry.message.toolName === 'write',
          );
          assert.equal(
            writes.length,
            2,
            'One original write and one revision, despite the retries',
          );
        }
        const messages = await team!.projectMessages(project.id);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].state, 'completed');
        assert.ok(messages[0].entryId);
        assert.equal(
          host.processes().some((item) => item.pid === qaPid),
          false,
        );
      } else if (mode === 'idle') {
        await until(
          () => host.processes().length === 0,
          'Three-stage chain completed, including both pre-opened recipients',
        );
        const saved = await store.projects.read(project.id);
        for (const id of ['next', 'last']) {
          const before = prior.get(id)!,
            after = saved.agents.find((a) => a.profile.id === id)!;
          assert.equal(after.runStatus, 'ready');
          assert.equal(after.session!.id, before.binding.id);
          assert.equal(after.session!.path, before.binding.path);
          const bytes = await readFile(
            join(await store.projects.directory(project.id), after.session!.path),
          );
          assert.ok(bytes.subarray(0, before.bytes.length).equals(before.bytes));
          const entries = bytes
            .toString()
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          const delivered = entries.filter(
            (e) =>
              e.type === 'message' &&
              e.message.role === 'user' &&
              JSON.stringify(e.message.content).includes('CHAIN_CURRENT_TASK'),
          );
          assert.equal(delivered.length, 1, 'One handoff in the exact previous JSONL, no replay');
          assert.equal(host.chat(target(id))!.runId, before.runId);
          assert.ok(autoPidChecks.some((check) => check.agentId === id));
        }
        assert.deepEqual(
          [...steps.entries()],
          [
            ['first', 3],
            ['next', 3],
            ['last', 3],
          ],
        );
        assert.equal(notices.length, 0);
      } else {
        await until(
          () => notices.some((n) => n.agentId === 'first' && n.failure === 'continuation'),
          'Source chain paused on busy recipient',
        );
        assert.equal(host.processes().length, 1);
        assert.equal(host.processes()[0].pid, expectedPids.get('next'));
        assert.equal(host.chat(target('next'))!.phase, 'ready');
        assert.equal(host.chat(target('next'))!.working, true);
        assert.equal(host.chat(target('next'))!.runId, prior.get('next')!.runId);
        assert.equal(steps.has('next'), false);
        assert.equal(steps.has('last'), false);
        const res = busyResponse!;
        res.write(`data: ${JSON.stringify(chunk({ content: ' BUSY_FINISHED' }))}\n\n`);
        end(res, false);
        busyResponse = undefined;
        await until(
          () =>
            host.inspect(project.id, 'next')?.status === 'waiting' &&
            !host.chat(target('next'))?.working,
          'Original recipient task completes normally',
        );
        await new Promise((done) => setTimeout(done, 200));
        assert.equal(steps.has('next'), false, 'No automatic retry after recipient becomes idle');
        const queue = host.chat(target('next'))!.queue;
        assert.deepEqual(queue?.steering ?? [], []);
        assert.deepEqual(queue?.followUp ?? [], []);
        assert.deepEqual(queue?.items ?? [], []);
        assert.equal(host.processes()[0].pid, expectedPids.get('next'));
        assert.ok(
          host
            .chat(target('next'))!
            .messages.some((m) => JSON.stringify(m).includes('PRIOR_HISTORY_next')),
        );
      }
      reports.push({
        mode,
        requests,
        inFlightRequestWasArmed: true,
        answeredAnAgentQuestionBeforeArming: mode === 'idle',
        keptSourcePidAndSentNoExtraInputWhenArmed: true,
        samePidForEachReusedRecipient: mode === 'idle',
        sameSessionAndJsonlPrefix: mode === 'idle' || correction,
        oneTaskNoReplay: mode === 'idle' || correction,
        busyRecipientPreservedAndNoLateRetry: mode === 'busy',
        earlierAgentCorrectionCompletedAndOriginalChainResumed: correction,
        reusedEarlierAgentPid: mode === 'correction-idle',
        nativeCodexConnectTimeouts: disconnects,
        nativeWindowsAcceptance: false,
      });
    } finally {
      releaseSource?.();
      releaseCorrectionRequest?.();
      releaseCorrectedOutput?.();
      busyResponse?.destroy();
      await host.drain();
      host.close();
      team?.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
  await writeFile(
    new URL(
      testReconnect
        ? '../artifacts/codex-reconnect-native-proof.json'
        : testCorrections
          ? '../artifacts/chain-correction-native-proof.json'
          : '../artifacts/chain-idle-reuse-native-proof.json',
      import.meta.url,
    ),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        pi: pi.version,
        realPiSdkProductionBridgeAndMcp: true,
        localSyntheticModelOnly: true,
        paidModelRequests: 0,
        reports,
        userStudioOrProcessesChanged: false,
        terminalOrDesktopPermissionsUsed: false,
        ownedTemporaryStudioRemoved: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(reports));
} finally {
  await rm(root, { recursive: true, force: true });
}
