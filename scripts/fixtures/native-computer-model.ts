// Real selected Pi model -> native MCP -> owned AppKit window; no personal target.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StudioStore } from '../../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../../src/main/pi/RunHost.ts';
import { productionTools } from '../../src/main/pi/RunChannel.ts';
import { ComputerSupport } from '../../src/main/computer/ComputerSupport.ts';
import type { CuaRuntime } from '../../src/main/computer/CuaRuntime.ts';
import type { Agent } from '../../src/shared/studio.ts';
import type { PreparedRun } from '../../src/main/pi/ContextBuilder.ts';
import type { resolveAgentLaunchConfig } from '../../src/main/pi/resolveAgentLaunchConfig.ts';

type Selection = Awaited<ReturnType<typeof resolveAgentLaunchConfig>> & {
  piPath: string;
  piVersion: string;
  bridge: string;
};
export async function runNativeVisualModel(
  root: string,
  runtime: CuaRuntime,
  target: { pid: number; windowId: number },
  selection: Selection,
  expectedCode: string,
) {
  const store = await StudioStore.open(join(root, 'model-studio'));
  const agent: Agent = {
    id: 'qa-native-visual-agent',
    name: 'QA native visual model',
    enabled: true,
    instructions: [],
    skills: [],
    plugins: [],
    mcps: ['pistudio-project', 'pistudio-computer'],
    mainInstruction:
      'Use only the exact owned QA target specified by the user. Do not interact with other applications or the desktop. Never search for test source/configuration/state files. Read the purple code card only from the computer screenshot. Use background AX actions only; never type Terminal commands for UI input.',
    model: selection.model,
  };
  await store.saveSection('agents', [agent]);
  const project = (
    await store.command({ kind: 'create', name: 'Native visual model QA', agents: [agent] })
  ).projects[0];
  const projectRoot = await store.projects.directory(project.id);
  const calls: { name: string; images: number }[] = [];
  let clicks = 0,
    screenshotsBeforeInput = 0,
    inputStarted = false;
  const allowedTools = new Set(['check_permissions', 'get_window_state', 'set_value', 'click']);
  const computer = new ComputerSupport({
    tools: async () => (await runtime.tools()).filter((tool) => allowedTools.has(tool.name)),
    permissions: () => runtime.permissions(),
    identify: (session, label) => runtime.identify(session, label),
    release: (session) => runtime.release(session),
    close: async () => {},
    call: async (session, name, args, signal) => {
      assert.ok(allowedTools.has(name));
      assert.equal(args.pid, target.pid);
      assert.equal(args.window_id, target.windowId);
      if (name === 'click') {
        clicks++;
        assert.equal(clicks, 1, 'Never repeat a native click in QA');
      }
      if (name === 'set_value' || name === 'click') {
        assert.ok(screenshotsBeforeInput > 0, 'Model must first receive actual pixels');
        inputStarted = true;
      }
      if (name === 'click') assert.equal(args.delivery_mode ?? 'background', 'background');
      const result = await runtime.call(session, name, args, signal);
      const images = result.content.filter((part) => part.type === 'image').length;
      if (name === 'get_window_state') {
        screenshotsBeforeInput += images;
        if (!inputStarted)
          assert.equal(
            result.content
              .filter((part) => part.type === 'text')
              .some((part) => part.text.includes(expectedCode)),
            false,
            'Visual code must not leak through AX/tool text',
          );
      }
      calls.push({ name, images });
      return result;
    },
  });
  let prepared: PreparedRun | undefined;
  const children: ReturnType<typeof spawn>[] = [];
  const exited: Promise<number | null>[] = [];
  const host = new RunHost({
    bootstraps: join(root, 'model-bootstraps'),
    bridge: selection.bridge,
    headless: true,
    tools: productionTools,
    mcpGroups: (run) => computer.groups(run),
    closed: (run) => computer.release(run),
    prepare: async () => {
      const current = await store.projects.read(project.id);
      const run = await buildRunContext(
        projectRoot,
        current,
        agent.id,
        [agent],
        [],
        undefined,
        selection.thinkingLevel,
      );
      run.modelAuth = selection.modelAuth;
      await computer.bind(run, true);
      prepared = run;
      return { run, piPath: selection.piPath };
    },
    update: (run, status, session, failure) =>
      store.projects.updateRuntime(run.project.id, agent.id, status, session, failure),
    read: (run) => store.projects.read(run.project.id),
    openTerminal: async (node, bridge, bootstrap) => {
      const child = spawn(node, [bridge, bootstrap], {
        stdio: 'ignore',
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      });
      children.push(child);
      exited.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
  });
  const timer = setTimeout(() => {
    host.close();
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  }, 180000);
  try {
    const firstMessage = `This is an isolated native Computer MCP QA task. Your only UI target is PID ${target.pid}, window_id ${target.windowId}. Use pi_studio_computer.get_window_state with a screenshot and AX tree for that window. Visually read the code on the purple card (it is intentionally absent from AX). Set the QA native input text field to that exact code using set_value. Click the QA increment button exactly once using its current AX token and delivery_mode background. Inspect the fresh screenshot after actions. Do not use foreground input, desktop capture, app discovery, browser, shell UI automation, test source/configuration/state files, or any other app/window. Save the code you read as vision-result.txt in your agent output directory, then call complete_stage with that file. Finish briefly; do not ask questions.`;
    assert.equal(firstMessage.includes(expectedCode), false);
    await host.launch({
      projectId: project.id,
      agentId: agent.id,
      autoContinue: false,
      firstMessage,
    });
    assert.equal(await exited[0], 0);
    const result = await store.projects.read(project.id);
    assert.equal(result.agents[0].runStatus, 'ready');
    assert.ok(prepared);
    assert.equal(
      (await readFile(join(prepared.record.output, 'vision-result.txt'), 'utf8')).trim(),
      expectedCode,
    );
    const state = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
    assert.equal(state.text, expectedCode);
    assert.equal(state.presses, 1);
    const transcript = (await readFile(join(projectRoot, result.agents[0].session!.path), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === 'message')
      .map((row) => row.message);
    assert.equal(transcript.filter((message) => message.role === 'user').length, 1);
    assert.ok(
      transcript.some(
        (message) => message.role === 'assistant' && message.model === selection.model.id,
      ),
    );
    assert.ok(calls.some((call) => call.name === 'set_value'));
    assert.ok(calls.some((call) => call.name === 'click'));
    return {
      actualModelLoop: true,
      actualNativePiMcp: true,
      model: selection.model.provider + '/' + selection.model.id,
      effort: selection.thinkingLevel,
      piVersion: selection.piVersion,
      scopedSelectedAccount: !!selection.modelAuth,
      randomCodeReadFromPixelsOnly: true,
      actualNativeFieldReadback: true,
      exactButtonPresses: 1,
      validatedOutput: true,
      canonicalSession: true,
      toolCalls: calls,
    };
  } finally {
    clearTimeout(timer);
    host.close();
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.allSettled(exited);
    await computer.drain();
  }
}
