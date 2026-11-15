import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { validateCompletedOutputs } from '../src/main/pi/completeStage.ts';
import { qaToolScope } from './qa-tool-scope.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Opt-in real model test: inspect the actual split plan before requesting merge.
// Only generated planning data is retained, never Studio role/skill instruction copies.
const continuation = process.argv.indexOf('--continue');
const verifyOnly = process.argv.includes('--verify-only');
assert.ok(!verifyOnly || continuation >= 0);
const root =
  continuation < 0
    ? await mkdtemp(join(tmpdir(), 'pistudio-shot-edits-'))
    : process.argv[continuation + 1];
assert.match(basename(root), /^pistudio-shot-edits-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const profile: Agent = {
  id: 'planner',
  name: 'Кадры — QA',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: ['qa-tool-scope'],
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
  mainInstruction:
    'Edit actual project planning files as explicitly requested. Preserve identities, semantic ordering and unrelated records. Use native read/edit/write and production complete_stage; work only in your owned output. No application changes, role/skill archives, media generation, dependencies, network, desktop interaction or playback. No approval gate. Read the current file, edit/check actual data, then complete_stage with planning.json. report_blocked for a real obstacle.',
};
if (continuation < 0) {
  await store.saveSection('connections', [
    {
      id: 'subscription',
      name: 'QA subscription',
      purpose: 'codex',
      providerId: 'openai-codex',
      endpoint: '',
      account: '',
      createdAt: 1,
    },
  ]);
  await store.saveSection('agents', [profile]);
  await store.command({
    kind: 'create',
    name: 'Разделение и объединение кадров — QA',
    agents: [profile],
  });
}
const project = store.bootstrap().projects[0],
  directory = await store.projects.directory(project.id);
const output = join(directory, project.agents[0].outputPath);
await mkdir(output, { recursive: true });
const scope = await qaToolScope(root, output);
await store.saveSection('resources', [scope.resource]);
await store.saveSection('agents', [profile]);
await store.command({
  kind: 'update-agents',
  projectId: project.id,
  agents: [profile],
  updateExisting: true,
});
assert.deepEqual((await store.projects.read(project.id)).agents[0].profile.plugins, [
  'qa-tool-scope',
]);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const observationPath = join(root, 'observations.json');
if (continuation < 0) {
  const source = await readFile('artifacts/animated-scene/animation.json');
  const animation = JSON.parse(source.toString());
  const seed = {
    schemaVersion: 1,
    sceneId: 'qa-terrace',
    durationInFrames: 240,
    shots: animation.shots.map((shot: any, index: number) => ({ ...shot, order: index + 1 })),
    aliases: {},
  };
  await writeFile(join(output, 'planning.json'), JSON.stringify(seed, null, 2) + '\n');
  await writeFile(
    observationPath,
    JSON.stringify({
      seed,
      source: { path: 'artifacts/animated-scene/animation.json', sha256: hash(source) },
    }),
  );
}
const observation = JSON.parse(await readFile(observationPath, 'utf8'));
const processes: ReturnType<typeof spawn>[] = [],
  exits: Promise<number | null>[] = [];
const pi = await checkPi('');
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: resolve('bundled/pi-bridge/session.mjs'),
  catalog: resolve('bundled/pi-bridge/catalog.mjs'),
  piPath: () => pi.path,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    processes.push(child);
    exits.push(
      new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      }),
    );
  },
});
const internal = host as unknown as {
  open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
};
const request = { projectId: project.id, agentId: profile.id, autoContinue: false };
const timeout = setTimeout(() => {
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
}, 4 * 60_000);
async function canonical() {
  const state = await store.projects.read(project.id);
  assert.ok(state.agents[0].session && !state.agents[0].session.missing);
  const path = state.agents[0].session.path;
  const text = await readFile(join(directory, path), 'utf8');
  const messages = text
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.message);
  const last = messages
    .filter(
      (message) =>
        message.role === 'toolResult' &&
        message.toolName === 'mcp__pi_studio__complete_stage' &&
        !message.isError,
    )
    .at(-1);
  const completion = JSON.parse(last.content.find((part: any) => part.type === 'text').text);
  assert.deepEqual(await validateCompletedOutputs(output, ['planning.json']), completion.outputs);
  assert.equal(
    messages.filter((message) => message.role === 'assistant').at(-1).stopReason,
    'stop',
  );
  return { path, text, messages, completion };
}
function check(plan: any) {
  assert.equal(plan.sceneId, observation.seed.sceneId);
  assert.equal(plan.durationInFrames, 240);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(new Set(plan.shots.map((shot: any) => shot.id)).size, plan.shots.length);
  let end = 0;
  plan.shots.forEach((shot: any, index: number) => {
    assert.match(shot.id, /^[a-zA-Z0-9_-]+$/);
    assert.equal(shot.order, index + 1);
    assert.equal(shot.from, end);
    assert.ok(Number.isSafeInteger(shot.duration) && shot.duration > 0);
    end += shot.duration;
  });
  assert.equal(end, 240);
}
function checkSplit(plan: any) {
  check(plan);
  const [original, unaffected] = observation.seed.shots;
  assert.equal(plan.shots.length, 3);
  assert.deepEqual(plan.shots[0], { ...original, duration: 57 });
  assert.deepEqual(plan.shots[2], { ...unaffected, order: 3 });
  assert.ok(!observation.seed.shots.some((shot: any) => shot.id === plan.shots[1].id));
  assert.deepEqual(plan.shots[1], {
    ...original,
    id: plan.shots[1].id,
    from: 57,
    duration: 57,
    order: 2,
  });
}
function checkMerged(plan: any) {
  check(plan);
  assert.deepEqual(plan.shots, observation.seed.shots);
  assert.equal(plan.aliases[observation.split.plan.shots[1].id], observation.seed.shots[0].id);
}
async function capture() {
  assert.equal(await exits.at(-1), 0);
  assert.equal((await store.projects.read(project.id)).agents[0].runStatus, 'ready');
  const completed = await canonical();
  const bytes = await readFile(join(output, 'planning.json'));
  return {
    plan: JSON.parse(bytes.toString()),
    text: bytes.toString(),
    sha256: hash(bytes),
    sessionPath: completed.path,
    completion: completed.completion.outputs,
    userMessages: completed.messages.filter((message) => message.role === 'user').length,
  };
}
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, verifyOnly }));
  if (!observation.split) {
    assert.ok(!verifyOnly, 'The split has not completed.');
    const task =
      'Read output/planning.json. Split its first shot (terrace-speech, range 0..113) into two shots at frame57: retain its existing ID for range0..56 (from0 duration57 order1), create one new unique ASCII ID for range57..113 (from57 duration57 order2). Preserve the camera text and other fields of the original in both halves. Preserve the existing second shot terrace-parallax-finish ID/from114/duration126/camera, changing only its order to3. Keep sceneId, durationInFrames240, aliases and every unrelated field unchanged. Write the actual current planning.json and complete_stage with planning.json. Do not merge yet; I need to inspect the intermediate file before the next request. No need for bash, use read/edit/write.';
    if (continuation < 0) await host.launch({ ...request, firstMessage: task });
    else await internal.open(request, task);
    observation.split = await capture();
    checkSplit(observation.split.plan);
    await writeFile(observationPath, JSON.stringify(observation));
    console.log(
      JSON.stringify({
        phase: 'split-verified',
        shotIds: observation.split.plan.shots.map((shot: any) => shot.id),
      }),
    );
  }
  checkSplit(observation.split.plan);
  if (!observation.merged) {
    assert.ok(!verifyOnly, 'The merge has not completed.');
    const before = await canonical();
    // Public Continue opens the exact dialogue and sends no message.
    await host.launch(request);
    assert.equal(await exits.at(-1), 0);
    assert.equal(await readFile(join(directory, before.path), 'utf8'), before.text);
    await internal.open(
      request,
      'Now merge ONLY the first two current shots in output/planning.json. Restore the original first ID terrace-speech covering from0 duration114 order1, with its original camera text. Preserve terrace-parallax-finish unchanged at from114 duration126 order2. Remove the extra split-shot record and set aliases[its removed ID]="terrace-speech" so the removed ID is never silently reused. Keep sceneId, durationInFrames, schemaVersion and unrelated fields unchanged. The actual plan must now contain exactly two contiguous shots. Read/edit/check the real file and complete_stage with planning.json. No new dialogue, media, source/code edits, dependencies or network. No need for bash.',
    );
    observation.merged = await capture();
    checkMerged(observation.merged.plan);
    assert.equal(observation.merged.sessionPath, observation.split.sessionPath);
    await writeFile(observationPath, JSON.stringify(observation));
  }
  checkMerged(observation.merged.plan);
  const final = await canonical();
  assert.equal(hash(await readFile(join(output, 'planning.json'))), observation.merged.sha256);
  assert.equal(final.path, observation.split.sessionPath);
  assert.notEqual(observation.split.sha256, observation.merged.sha256);
  await host.launch(request);
  assert.equal(await exits.at(-1), 0);
  assert.equal(await readFile(join(directory, final.path), 'utf8'), final.text);
  assert.equal(hash(await readFile(join(output, 'planning.json'))), observation.merged.sha256);
  const artifact = resolve('artifacts/shot-edits');
  await mkdir(artifact, { recursive: true });
  const stageText = (stage: { text?: string; sha256: string }) => {
    // Older retained runs can recover the exact bytes from an actual native read.
    // Copy only this generated plan, never the surrounding session/role text.
    const text =
      stage.text ??
      final.messages
        .filter((message) => message.role === 'toolResult' && message.toolName === 'read')
        .flatMap((message) =>
          message.content.filter((part: any) => part.type === 'text').map((part: any) => part.text),
        )
        .find((text: string) => hash(text) === stage.sha256);
    assert.equal(typeof text, 'string');
    assert.equal(hash(text), stage.sha256);
    return text;
  };
  await writeFile(join(artifact, 'before.json'), JSON.stringify(observation.seed, null, 2) + '\n');
  await writeFile(join(artifact, 'split.json'), stageText(observation.split));
  await writeFile(join(artifact, 'merged.json'), stageText(observation.merged));
  const proof = {
    checkedAt: new Date().toISOString(),
    applicationVersion: '0.2.0-alpha.60',
    actualPi: pi.version,
    model: profile.model!.id,
    seed: observation.source,
    actualSplitReadBeforeMerge: true,
    artifactBytesMatchNativeCompletion: true,
    actualSplitCompletion: observation.split.completion,
    actualMergeCompletion: observation.merged.completion,
    intermediateSplitSha256: observation.split.sha256,
    finalMergeSha256: observation.merged.sha256,
    stableSceneAndUnaffectedShot: true,
    contiguousSemanticOrder: true,
    removedIdAlias: observation.merged.plan.aliases,
    sameCanonicalDialogue: true,
    idleResumeWithoutReplay: true,
    totalUserMessages: final.messages.filter((message) => message.role === 'user').length,
    paidMediaCalls: 0,
    userStudioTouched: false,
    limits:
      'Real Pi edits of generated project planning files; seed derived from the previously verified animation. No app-side scene editor or split/merge engine. No role/skill instruction snapshots retained.',
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'passed', artifact, studio: root, ...proof }));
} catch (error) {
  await writeFile(join(root, 'qa-findings.json'), JSON.stringify({ error: String(error) }));
  throw error;
} finally {
  clearTimeout(timeout);
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  console.log('Owned QA retained for review: ' + root);
}
