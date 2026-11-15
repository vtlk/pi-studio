import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
  cp,
  access,
} from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { validateCompletedOutputs } from '../src/main/pi/completeStage.ts';
import { qaLibraryPreview } from './qa-library-preview.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Real ordinary agent plans a scenario, publishes a location, then edits only its project data.
const continuation = process.argv.indexOf('--continue');
const verifyOnly = process.argv.includes('--verify-only');
assert.ok(!verifyOnly || continuation >= 0, 'Verification requires the retained owned QA root.');
const root =
  continuation >= 0
    ? process.argv[continuation + 1]
    : await mkdtemp(join(tmpdir(), 'pistudio-scene-plan-'));
assert.match(basename(root), /^pistudio-scene-plan-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const artifact = resolve('artifacts/scene-plan');
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const full = join(path, entry.name);
    if (entry.isDirectory())
      for (const [key, value] of Object.entries(await fingerprint(full)))
        result[join(entry.name, key)] = value;
    else result[entry.name] = hash(await readFile(full));
  }
  return result;
}
const profile: Agent = {
  id: 'planner',
  name: 'Сценарий и локация',
  enabled: true,
  skills: [],
  mcps: ['pistudio-library'],
  plugins: [],
  instructions: [],
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
  mainInstruction:
    'You are an ordinary scenario/library artist in disposable Pi Studio QA. Work only in your project output or main-owned library staging. Read current library/project contracts, use native bash/read and assigned production MCP. No application source, credentials, unrelated projects, external/paid media services, dependencies, backups or desktop playback. Existing library data is immutable: use prepare/validate/publish for updates. Do not copy instructions into assets. No approval gate; validate real files and complete_stage, or report_blocked on a real obstacle.',
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
  const ruby = JSON.parse(await readFile('artifacts/library-lifecycle/proof.json', 'utf8'));
  await cp(
    resolve('artifacts/library-lifecycle/versions'),
    join(store.folder, 'library/characters', ruby.assetId, 'versions'),
    { recursive: true },
  );
  await store.command({ kind: 'create', name: 'Фонарь у маяка — QA', agents: [profile] });
}
const project = store.bootstrap().projects[0],
  directory = await store.projects.directory(project.id);
const output = join(directory, project.agents[0].outputPath);
await mkdir(output, { recursive: true });
const observationPath = join(root, 'observations.json');
if (continuation < 0)
  await writeFile(
    observationPath,
    JSON.stringify({ characters: await fingerprint(join(store.folder, 'library/characters')) }),
  );
const observation = JSON.parse(await readFile(observationPath, 'utf8'));
assert.ok(!verifyOnly || observation.initialPlan, 'The initial scenario must be completed first.');
let v1 = observation.v1;
const publish = store.library.publish.bind(store.library);
store.library.publish = async (path, token) => {
  const result = await publish(path, token);
  if (result.manifest.kind === 'locations' && result.manifest.version === 1) {
    v1 = {
      id: result.manifest.id,
      directory: result.directory,
      files: await fingerprint(result.directory),
    };
    observation.v1 = v1;
    await writeFile(observationPath, JSON.stringify(observation));
  }
  if (result.manifest.kind === 'locations' && result.manifest.version === 2) {
    assert.equal(result.manifest.id, v1.id);
    assert.deepEqual(await fingerprint(v1.directory), v1.files);
  }
  return result;
};
const preview = await qaLibraryPreview(root),
  pi = await checkPi('');
const processes: ReturnType<typeof spawn>[] = [],
  exits: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: resolve('bundled/pi-bridge/session.mjs'),
  catalog: resolve('bundled/pi-bridge/catalog.mjs'),
  piPath: () => pi.path,
  libraryPreview: preview.render,
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
const timeout = setTimeout(() => {
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
}, 10 * 60_000);
const internal = host as unknown as {
  open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
};
const request = { projectId: project.id, agentId: profile.id, autoContinue: false };
const firstTask = `Parse this short scenario into real editable project files, not a fictional UI:
Scene A, daytime on the terrace of a lighthouse: the girl Руби in red puts a red lantern on a bench, her dog Бим waits beside her. Руби says "Этот фонарь поможет путникам"; Бим replies "Гав!". Scene B, the SAME terrace at dusk: Руби hangs the SAME lantern on a hook; Бим falls asleep nearby. Руби says "Теперь дорога светлее".

Create planning.json with explicit schema:
{characters:[{id,name,libraryReference?:{kind,id,version}}],locations:[{id,name,libraryReference:{kind,id,version}}],props:[{id,name}],dialogues:[{id,speakerId,text}],scenes:[{id,title,locationId,characterIds,propIds,dialogueIds,shots:[{id,order,camera,description}]}],counters:{characters,locations,props,dialogues,scenes,shots},libraryRecommendations:[{characterId,action:"reuse"|"create",assetId?,version?,reason}],locationUpgradeProposal:{id,version:2}}.
Use stable unique ASCII IDs. Exactly two characters, one location, one lantern prop, three dialogue lines, two ordered scenes and one shot per scene. Resolve the existing Руби library character via find/get and pin its current version; propose creating Бим because no dog exists, without publishing another character. Do not edit the existing character library files. Write a formatted scene card for EACH scene to scenes/<scene-id>.md with scenario/location/participants/props/actual lines/shot IDs/order/camera.

Use assigned Library MCP to create ONE original static SVG location "Терраса у маяка" with a clearly usable bench, hook, railings and open foreground space for the actions. No characters baked into it. Read library_get_contract, prepare kind locations, preserve identity fields. Make reference.png yourself from the authored SVG using installed CairoSVG/Pillow (no user reference is attached), declare location.svg. Use a broad visible sky rect id="sky" fill="#87CFEA" in v1. Call trusted library_render_preview, copy PNG to declared preview, validate/publish v1. Both scenes must reference this SAME location ID pinned to version 1. Do not create two library cards or duplicate background sources per scene.

Then get that published location, prepare existingId and publish v2 with only its sky changed to fill="#F5A45D" for dusk. Use the trusted preview again. Preserve v1 exactly, read explicit v1 and latest v2, record locationUpgradeProposal version2 but keep both scene location pins at1 until an explicit later choice. Find/list should show one current location. No generated scripts executed by the app; original SVG/PNG data only. Complete with planning.json and the two actual scene Markdown cards after all validations. Do not modify app code, install dependencies, call paid APIs or archive instructions.`;
async function ready() {
  assert.equal(await exits.at(-1), 0);
  const state = await store.projects.read(project.id);
  assert.equal(state.agents[0].runStatus, 'ready');
  return state;
}
function checkPlan(plan: any, edited: boolean) {
  for (const key of ['characters', 'locations', 'props', 'dialogues', 'scenes']) {
    assert.equal(new Set(plan[key].map((item: any) => item.id)).size, plan[key].length);
    assert.equal(plan.counters[key], plan[key].length);
  }
  assert.deepEqual(
    [
      plan.characters.length,
      plan.locations.length,
      plan.props.length,
      plan.dialogues.length,
      plan.scenes.length,
    ],
    edited ? [1, 1, 1, 1, 1] : [2, 1, 1, 3, 2],
  );
  const shots = plan.scenes.flatMap((scene: any) => {
    assert.ok(plan.locations.some((item: any) => item.id === scene.locationId));
    for (const [field, records] of [
      ['characterIds', plan.characters],
      ['propIds', plan.props],
      ['dialogueIds', plan.dialogues],
    ] as const)
      assert.ok(scene[field].every((id: string) => records.some((item: any) => item.id === id)));
    return scene.shots;
  });
  assert.equal(shots.length, edited ? 1 : 2);
  assert.equal(new Set(shots.map((shot: any) => shot.id)).size, shots.length);
  assert.equal(plan.counters.shots, shots.length);
  for (const line of plan.dialogues)
    assert.ok(plan.characters.some((item: any) => item.id === line.speakerId));
}
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, continuation: continuation >= 0 }));
  if (!observation.initialPlan) {
    if (continuation >= 0)
      await internal.open(
        request,
        'Finish the existing initial task, reading qa-findings.json for a failed check. Reuse the published IDs/versions already present; do not duplicate or republish completed versions. ' +
          firstTask,
      );
    else await host.launch({ ...request, firstMessage: firstTask });
    const state = await ready();
    const plan = JSON.parse(await readFile(join(output, 'planning.json'), 'utf8'));
    checkPlan(plan, false);
    const location = plan.locations[0];
    assert.deepEqual(location.libraryReference, { kind: 'locations', id: v1.id, version: 1 });
    assert.deepEqual(plan.locationUpgradeProposal, { id: v1.id, version: 2 });
    const recs = plan.libraryRecommendations;
    assert.ok(
      recs.some((item: any) => item.action === 'reuse' && item.assetId && item.version === 3),
    );
    assert.ok(recs.some((item: any) => item.action === 'create' && item.reason));
    for (const scene of plan.scenes) {
      const text = await readFile(join(output, 'scenes', scene.id + '.md'), 'utf8');
      for (const id of scene.dialogueIds)
        assert.ok(text.includes(plan.dialogues.find((line: any) => line.id === id).text));
      for (const shot of scene.shots) assert.ok(text.includes(shot.id));
    }
    observation.initialPlan = plan;
    observation.initialTranscript = hash(
      await readFile(join(directory, state.agents[0].session!.path)),
    );
    observation.library = await fingerprint(join(store.folder, 'library'));
    observation.sessionPath = state.agents[0].session!.path;
    await writeFile(observationPath, JSON.stringify(observation));
    console.log(
      JSON.stringify({ phase: 'initial-valid', counts: plan.counters, locationId: v1.id }),
    );
  }
  const original = observation.initialPlan;
  const firstScene = original.scenes[0],
    secondScene = original.scenes[1];
  const ruby = original.characters.find((item: any) => item.name.includes('Руби'));
  const dog = original.characters.find((item: any) => item.id !== ruby.id);
  const beforeText = await readFile(join(directory, observation.sessionPath), 'utf8');
  if (!verifyOnly)
    await internal.open(
      request,
      `Edit this project through this exact dialogue. Remove scene ${secondScene.id} and character ${dog.id} (${dog.name}) from planning.json, remove their dialogue records/references and the deleted scene Markdown card. Keep scene ${firstScene.id}, its shot ID/order, Руби ${ruby.id}, lantern prop and the location pin1 unchanged. Update counters and remaining scene Markdown so the removed dog is no longer listed. Keep libraryRecommendations only for remaining characters. Record removed:{sceneIds:["${secondScene.id}"],characterIds:["${dog.id}"]} in planning.json to avoid reusing their IDs. Do NOT delete or change ANY library asset/version/source; no new publication, no app-code edit and no reset of the original dialogue. Complete with planning.json and scenes/${firstScene.id}.md after checking current files. If qa-findings.json exists, correct its factual failed check while preserving this scope.`,
    );
  const updated = verifyOnly ? await store.projects.read(project.id) : await ready();
  if (!verifyOnly) assert.equal(updated.agents[0].runStatus, 'ready');
  else {
    // Runtime status is intentionally process-local. Recheck the canonical main-validated
    // completion against current bytes instead of requiring a live host after restart.
    const entries = (await readFile(join(directory, observation.sessionPath), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    const messages = entries
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
    const completion = JSON.parse(last.content.find((block: any) => block.type === 'text').text);
    assert.equal(completion.validated, true);
    assert.deepEqual(
      await validateCompletedOutputs(
        output,
        completion.outputs.map((item: any) => item.path),
      ),
      completion.outputs,
    );
    assert.equal(
      messages.filter((message) => message.role === 'assistant').at(-1).stopReason,
      'stop',
    );
  }
  assert.equal(updated.agents[0].session!.path, observation.sessionPath);
  const final = JSON.parse(await readFile(join(output, 'planning.json'), 'utf8'));
  checkPlan(final, true);
  assert.equal(final.scenes[0].id, firstScene.id);
  assert.deepEqual(
    final.scenes[0].shots.map((shot: any) => [shot.id, shot.order]),
    firstScene.shots.map((shot: any) => [shot.id, shot.order]),
  );
  assert.ok(!JSON.stringify(final.scenes).includes('Бим'));
  assert.ok(
    final.libraryRecommendations.every((item: any) =>
      final.characters.some((character: any) => character.id === item.characterId),
    ),
  );
  assert.deepEqual(final.characters[0], ruby);
  assert.deepEqual(final.locations, original.locations);
  assert.deepEqual(final.props, original.props);
  assert.deepEqual(final.removed, { sceneIds: [secondScene.id], characterIds: [dog.id] });
  await assert.rejects(access(join(output, 'scenes', secondScene.id + '.md')));
  const card = await readFile(join(output, 'scenes', firstScene.id + '.md'), 'utf8');
  assert.ok(!card.includes(dog.name));
  assert.deepEqual(await fingerprint(join(store.folder, 'library')), observation.library);
  assert.deepEqual(
    await fingerprint(join(store.folder, 'library/characters')),
    observation.characters,
  );
  const first = await store.library.get('locations', v1.id, 1),
    latest = await store.library.get('locations', v1.id);
  assert.equal(latest.manifest.version, 2);
  assert.deepEqual(await fingerprint(first.directory), v1.files);
  assert.equal(
    (await store.library.list()).assets.filter((asset) => asset.library.kind === 'locations')
      .length,
    1,
  );
  const previewColors = [];
  for (const asset of [first, latest]) {
    const data = execFileSync(
      '/opt/homebrew/bin/ffmpeg',
      [
        '-v',
        'error',
        '-i',
        join(asset.directory, asset.manifest.files.preview),
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        '-',
      ],
      { maxBuffer: 16 * 1024 ** 2 },
    );
    const rgb = asset.manifest.version === 1 ? [135, 207, 234] : [245, 164, 93];
    let matches = 0;
    for (let i = 0; i < data.length; i += 3)
      if (rgb.every((value, channel) => Math.abs(data[i + channel] - value) < 3)) matches++;
    assert.ok(matches > 1000, 'Published preview must actually show the requested sky color');
    previewColors.push({ version: asset.manifest.version, skyPixels: matches });
  }
  const session = join(directory, observation.sessionPath),
    text = await readFile(session, 'utf8');
  const users = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .filter((entry) => entry.message?.role === 'user').length;
  assert.equal(users(text), users(beforeText) + (verifyOnly ? 0 : 1));
  const messages = text
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.message);
  assert.ok(
    messages.some(
      (message) =>
        message.role === 'user' &&
        JSON.stringify(message.content).includes(`Remove scene ${secondScene.id}`) &&
        JSON.stringify(message.content).includes(dog.id),
    ),
  );
  for (const tool of [
    'library_find_assets',
    'library_get_asset',
    'library_prepare_asset',
    'library_render_preview',
    'library_validate_asset',
    'library_publish_asset',
  ])
    assert.ok(
      messages.some(
        (message) =>
          message.role === 'toolResult' &&
          message.toolName === 'mcp__pi_studio__' + tool &&
          !message.isError,
      ),
    );
  assert.ok(!messages.some((message) => /configure_agent/.test(message.toolName ?? '')));
  await host.launch(request);
  assert.equal(await exits.at(-1), 0);
  assert.equal(await readFile(session, 'utf8'), text);
  await mkdir(artifact, { recursive: true });
  await cp(join(store.folder, 'library/locations', v1.id, 'versions'), join(artifact, 'versions'), {
    recursive: true,
  });
  await cp(join(output, 'planning.json'), join(artifact, 'planning.json'));
  await cp(join(output, 'scenes'), join(artifact, 'scenes'), { recursive: true });
  await writeFile(
    join(artifact, 'initial-planning.json'),
    JSON.stringify(original, null, 2) + '\n',
  );
  const previewCalls = messages.filter(
    (message) =>
      message.role === 'toolResult' &&
      message.toolName === 'mcp__pi_studio__library_render_preview' &&
      !message.isError,
  ).length;
  await writeFile(
    join(artifact, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: '0.2.0-alpha.60',
        actualPi: pi.version,
        model: profile.model!.id,
        locationId: v1.id,
        projectId: project.id,
        initialScenarioCounts: original.counters,
        currentCounts: final.counters,
        actualLibraryMcpPublication: true,
        sameLocationForBothScenes: true,
        oneCurrentLocationTwoPreservedVersions: true,
        pinnedV1WithExplicitV2Proposal: true,
        existingCharacterRecommendationAndMissingDogProposal: true,
        currentSceneCardsMatchTheirDialogue: true,
        exactDialogueProjectSceneAndRoleDeletion: true,
        libraryUnchangedByProjectDeletion: true,
        remainingStableSceneShotCharacterIds: true,
        currentAttemptAdditionalEditInputs: verifyOnly ? 0 : 1,
        totalSessionUserMessages: users(text),
        deletionRequestedInCanonicalDialogue: true,
        exactIdleResumeWithoutReplay: true,
        previewColors,
        trustedPreviewCallsInDialogue: previewCalls,
        previewFramesThisAttempt: preview.frames(),
        paidMediaApiCalls: 0,
        userStudioTouched: false,
        limits:
          'Small concrete scenario/file workflow through one ordinary agent; no fixed production screens or claim of arbitrary NLP/artistic quality. Native library camera/scene card UI checked separately before cleanup.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ phase: 'passed', artifact, studio: root, previewColors }));
} catch (error) {
  await writeFile(
    join(output, 'qa-findings.json'),
    JSON.stringify({ error: String(error) }, null, 2),
  );
  throw error;
} finally {
  clearTimeout(timeout);
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  await preview.close();
  console.log('Owned QA retained until native UI review: ' + root);
}
