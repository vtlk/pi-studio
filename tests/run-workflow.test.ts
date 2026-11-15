import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import { parseAgent } from '../src/main/storage/validation.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';

const base = {
  id: 'qa',
  name: 'QA',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
};

test('legacy approval flags are ignored and fresh prompts remove mandatory production reviews for every agent', () => {
  assert.equal(
    Object.hasOwn(parseAgent({ ...base, requiresSceneApproval: true }), 'requiresSceneApproval'),
    false,
  );
  for (const serviceAgent of [false, true]) {
    const instructions = 'CUSTOM_ROLE_TEXT_REMAINS_CURRENT';
    const prompt = sessionSystemPrompt({
      serviceAgent,
      instructions,
      record: {
        projectRoot: '/qa/project',
        cwd: '/qa/project/agents/qa',
        output: '/qa/project/agents/qa/output',
        previousOutputs: [],
      },
    });
    assert.ok(prompt.includes(instructions));
    assert.match(prompt, /no mandatory approval\/acceptance steps/);
    assert.doesNotMatch(prompt, /require human acceptance|required approvals/);
  }
});

test('questions pause a chain until a new user request; completion still requires current unchanged outputs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  const live = {
    run: { projectRoot: root, record: { runId: 'qa', output } },
    request: { autoContinue: true },
    sequence: 0,
    blocked: false,
    status: 'waiting',
    heartbeat: 0,
  } as LiveRun;
  const transitions: string[] = [];
  let handoffs = 0;
  const lifecycle = new RunLifecycle({
    bootstraps: '',
    bridge: '',
    prepare: async () => {
      throw new Error('Not used');
    },
    read: async () => live.run.project,
    update: async (_run, status) => {
      transitions.push(status);
      return live.run.project;
    },
    completed: async () => {
      handoffs++;
    },
  });
  await writeFile(join(output, 'result.txt'), 'initial');
  await lifecycle.event(live, { type: 'request', message: 'Produce the requested output' });
  await lifecycle.tool(live, 'report_blocked', {});
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'waiting');
  assert.equal(handoffs, 0);
  await lifecycle.event(live, {
    type: 'request',
    message: 'The missing input is provided; finish the task',
  });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await writeFile(join(output, 'result.txt'), 'changed after completion');
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'error');
  assert.equal(handoffs, 0);
  await lifecycle.event(live, {
    type: 'request',
    message: 'Finish with the current corrected result',
  });
  await lifecycle.tool(live, 'complete_stage', { outputs: ['result.txt'] });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'ready');
  assert.equal(handoffs, 1, 'A repeated settled event never starts the next stage twice');
  await lifecycle.event(live, { type: 'request', message: 'Another task' });
  await lifecycle.event(live, { type: 'settled', outcome: 'completed' });
  assert.equal(live.status, 'waiting', 'A previous completion is never reused by the next request');
  assert.equal(handoffs, 1);
  assert.ok(transitions.includes('error'));
});

test('fresh prompts direct native writes to cwd-relative output and forbid reconstructing project slugs', () => {
  const prompt = sessionSystemPrompt({
    instructions: 'ROLE',
    record: {
      projectId: 'project',
      projectRoot: '/project-real-slug',
      cwd: '/project-real-slug/agents/voice',
      output: '/project-real-slug/agents/voice/output',
      previousOutputs: [],
    },
  });
  assert.match(prompt, /cwd-relative output\/<filename>/);
  assert.match(prompt, /Use supplied paths verbatim/);
  assert.match(prompt, /never reconstruct or transliterate a project folder/);
  assert.match(prompt, /look-alike Cyrillic\/Latin letters/);
});
