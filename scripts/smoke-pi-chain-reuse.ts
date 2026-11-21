/** Real Pi SDK + production chain/MCP with a local synthetic model; never opens Terminal or a user studio. */
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
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
const reports: unknown[] = [];
try {
  for (const mode of ['idle', 'busy'] as const) {
    let host: ReturnType<typeof createStudioRunHost>;
    let failure: unknown,
      requests = 0,
      busyResponse: ServerResponse | undefined,
      releaseSource: (() => void) | undefined;
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
        assert.equal(request.url, '/v1/chat/completions');
        assert.equal(request.headers.authorization, undefined);
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(Buffer.from(part));
        const body = JSON.parse(Buffer.concat(parts).toString());
        assert.equal(body.model, 'qa-chain');
        requests++;
        const system = JSON.stringify(
          body.messages.filter((m: { role: string }) => m.role === 'system'),
        );
        const stage = system.match(/QA_CHAIN_STAGE:(first|next|last)/)?.[1];
        assert.ok(stage);
        const lastUser = JSON.stringify(
          body.messages.findLast((m: { role: string }) => m.role === 'user').content,
        );
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
        assert.ok(lastUser.includes('CHAIN_CURRENT_TASK'));
        if (expectedPids.has(stage)) {
          const actual = host.processes().find((p) => p.agentId === stage)!;
          assert.equal(actual.pid, expectedPids.get(stage));
          autoPidChecks.push({ agentId: stage, pid: actual.pid });
        }
        assert.ok(
          mode !== 'busy' || stage === 'first',
          'Busy next agent must never receive the automatic message',
        );
        const step = steps.get(stage) ?? 0;
        steps.set(stage, step + 1);
        assert.ok(step < 3, 'No duplicate generation/task');
        const tools = body.tools.map((t: { function: { name: string } }) => t.function);
        const tool =
          step === 0
            ? tools.find((t: { name: string }) => t.name === 'write')
            : step === 1
              ? tools.find((t: { name: string }) => t.name.endsWith('complete_stage'))
              : undefined;
        if (step < 2) assert.ok(tool);
        const args =
          step === 0
            ? { path: 'output/result.txt', content: 'RESULT_' + stage }
            : { outputs: ['result.txt'] };
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: stage + '-' + step,
                  type: 'function',
                  function: { name: tool.name, arguments: JSON.stringify(args) },
                },
              ],
            }
          : { role: 'assistant', content: 'CHAIN_FINISHED_' + stage };
        const respond = () => {
          response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
          end(response, !!tool);
        };
        if (stage === 'first' && step === 0) releaseSource = respond;
        else respond();
      } catch (error) {
        failure = error;
        response.end('QA rejected request');
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
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
    await store.saveSection('connections', [connection]);
    const agents: Agent[] = ['first', 'next', 'last'].map((id) => ({
      id,
      name: id,
      enabled: true,
      mainInstruction: 'QA_CHAIN_STAGE:' + id,
      instructions: [],
      skills: [],
      mcps: [],
      plugins: [],
      model: {
        connectionId: connection.id,
        provider: connection.providerId,
        id: 'qa-chain',
        reasoning: 'off',
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
    host = createStudioRunHost(service, {
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
      const limit = Date.now() + 25000;
      while (!check() && Date.now() < limit) {
        if (failure) throw failure;
        await new Promise((done) => setTimeout(done, 25));
      }
      if (failure) throw failure;
      assert.ok(check(), label);
    };
    const prior = new Map<string, { binding: SessionBinding; bytes: Buffer; runId: string }>();
    try {
      for (const id of mode === 'idle' ? ['next', 'last'] : ['next']) {
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
      if (mode === 'idle') host.setAutoContinuation({ ...target('first'), enabled: true });
      else
        assert.equal(
          (await host.launch({ ...target('first'), autoContinue: true })).runId,
          first.runId,
        );
      assert.equal(host.processes().find(({ agentId }) => agentId === 'first')!.pid, pid);
      assert.equal(requests, requestsBeforeArm, 'Arming never sends another model request');
      releaseSource!();
      releaseSource = undefined;
      if (mode === 'idle') {
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
        sameSessionAndJsonlPrefix: mode === 'idle',
        oneTaskNoReplay: mode === 'idle',
        busyRecipientPreservedAndNoLateRetry: mode === 'busy',
        nativeWindowsAcceptance: false,
      });
    } finally {
      releaseSource?.();
      busyResponse?.destroy();
      await host.drain();
      host.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
  await writeFile(
    new URL('../artifacts/chain-idle-reuse-native-proof.json', import.meta.url),
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
