import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  writeFile,
  readdir,
  rm,
  realpath,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep, basename, dirname } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { readVideoProject } from '../src/main/video/readVideoProject.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Opt-in actual-model workflow. Uses only generated QA artwork and local free synthesis.
// Public launch remains message-free on resume; explicit follow-up injection is QA-only.
const continuationIndex = process.argv.indexOf('--continue');
const continuation = continuationIndex >= 0;
const root = continuation
  ? process.argv[continuationIndex + 1]
  : await mkdtemp(join(tmpdir(), 'pistudio-voice-workflow-'));
assert.match(basename(root), /^pistudio-voice-workflow-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const deadline = Date.now() + 15 * 60_000;
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const agent: Agent = {
  id: 'sound-artist',
  name: 'Озвучка и звуковой план',
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  mainInstruction:
    'You are an actual production artist in a disposable Pi Studio QA project. Use native bash and production project MCP to create real deliverables. Work only in your output; no application source, credentials, other projects, downloads, dependencies, paid media services or backups. No approval gate. Never play audio on the desktop: synthesize to files only. Use complete_stage with your final files after validation, or report_blocked on a real obstacle. Do not substitute metadata/claims for actual media.',
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
};
if (!continuation)
  await store.saveSection('connections', [
    {
      id: 'subscription',
      name: 'QA ChatGPT subscription',
      purpose: 'codex',
      providerId: 'openai-codex',
      endpoint: '',
      account: '',
      createdAt: 1,
    },
  ]);
if (!continuation) await store.saveSection('agents', [agent]);
const project = continuation
  ? store.bootstrap().projects[0]
  : (await store.command({ kind: 'create', name: 'Голоса и кадры — QA', agents: [agent] }))
      .projects[0];
const directory = await store.projects.directory(project.id);
const output = join(directory, project.agents[0].outputPath);
await mkdir(join(output, 'input'), { recursive: true });
if (!continuation)
  await cp(resolve('artifacts/film-revision/film.mp4'), join(output, 'input/source.mp4'));
const pi = await checkPi('');
const processes: ChildProcess[] = [],
  exits: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
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
const task = `Create real Russian voice/sound deliverables for the supplied 8-second 1080x1920/30fps cartoon input/source.mp4 (girl waters flower; flower blooms). The input is earlier QA-agent-created art, never a user file. Keep 240 frames and meaningful two-shot order. Use /opt/homebrew/bin/ffmpeg and ffprobe, Python stdlib, and installed /usr/bin/say -v Milena -o FILE (no playback/download). All final files under 24 MiB; avoid retained frames.

1. Invent short Russian lines for a narrator, girl and talking flower, with separate stable speaker IDs and voice configuration per role. Milena is the installed Russian voice; roles may share it but use explicit distinct rate configurations. Write production.json with characters:[{id,name,voice:{engine,name,rate}}], locations:[{id,name}], props:[{id,name}], scenes:[{id,locationId,characterIds,propIds,dialogueIds,shots:[{id,from,duration,camera,actionIds}]}], counters:{characters,locations,props,scenes,shots,dialogues}, dialogues:[{id,speakerId,text,file,duration,timelineStart,words:[{text,file,start,end}]}], and dependencies:[{id,inputs,stale:false}]. Times are seconds except shot from/duration are frames. Have exactly two shots covering 0..239. Stable entities and references must be consistent. Include a watering-can prop and scene actions. Include scene descriptions/participant/dialogue/camera information in scene-plan.md.

2. Real word timings, not estimated text timing: synthesize each spoken word separately with say, convert to mono 24000 Hz PCM s16le WAV and concatenate EXACT word samples plus explicit short silence gaps into the line WAV. Set word start/end from actual PCM sample counts within the line; no resynthesis/resampling of the concatenated line. Keep each word WAV for verification. This deliberately checks deterministic segmented synthesis; do not claim it is forced alignment of continuous speech. Fit the three lines with pauses in 8 seconds. Save a second take for the girl's same line with a different speaking rate, and takes.json recording dialogueId, both files, selected file and rate. Do not play them. Narration must be a separately assigned speaker.

3. Create four separate real stereo PCM WAV stems, exactly 8 seconds, named stems/speech.wav, ambience.wav, effects.wav, music.wav. Speech contains the selected line takes at their timeline starts. Synthesize quiet local ambience, one water-related effect synchronized with an action, and a gentle original music tone pattern. Use audible-but-unclipped gains, pans in [-1,1]. Write sound-plan.json as {sounds:[{id,layer,file,start,duration,volume,pan,actionId?}]} for the actual source sounds, with all four layers present, and mix-report.json describing real probe/sample measurements. Preserve actual separate source sounds and line files. Never replace sound with just JSON.

4. Create visual.mp4: same moving source imagery without its old audio and with a clean panel covering old burned captions (bottom 420px is sufficient). Extract one real image per shot for a STATIC two-shot animatic with the new speech and pauses, animatic.mp4 (8 seconds). Write the source script for this work. Create final film.mp4 by mixing the FOUR stems into visual.mp4 and burning the new uppercase Russian captions. Keep video H.264 yuv420p, AAC sound, 1080x1920/30fps/240 frames. Get the video contract and create valid film.pistudio.json/timeline.json: visual track uses silent visual.mp4; FOUR separate audio tracks use the four full-length stems at volume 1/pan 0 (source gains/pans already baked); subtitles track uses the actual lines/timing, readable on the bottom panel. Validate_video_project and ffprobe/decode the real outputs before complete_stage. Include production.json, takes.json, sound-plan.json, mix-report.json, scene-plan.md, animatic.mp4, film.mp4, timeline.json and film.pistudio.json in completion.`;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const json = async (name: string) => JSON.parse(await readFile(join(output, name), 'utf8'));
const pcm = (path: string, channels = 1) =>
  execFileSync(
    '/opt/homebrew/bin/ffmpeg',
    ['-v', 'error', '-i', path, '-ar', '24000', '-ac', String(channels), '-f', 's16le', '-'],
    { maxBuffer: 8 * 1024 ** 2 },
  );
async function file(name: string) {
  const path = await realpath(resolve(output, name));
  const inside = relative(await realpath(output), path);
  assert.ok(inside && inside !== '..' && !inside.startsWith('..' + sep));
  return path;
}
async function readPlan() {
  const plan = await json('production.json');
  assert.ok(plan.characters.length >= 3);
  assert.ok(plan.locations.length > 0 && plan.props.length > 0 && plan.scenes.length > 0);
  assert.ok(
    plan.characters.every(
      (item: any) =>
        item.id &&
        ['say', 'macos-say'].includes(item.voice.engine) &&
        item.voice.name === 'Milena' &&
        item.voice.rate > 0,
    ),
  );
  const ids = new Set(plan.characters.map((item: any) => item.id));
  assert.equal(ids.size, plan.characters.length);
  assert.equal(plan.dialogues.length, 3);
  assert.equal(new Set(plan.dialogues.map((item: any) => item.speakerId)).size, 3);
  const shots = plan.scenes.flatMap((scene: any) => {
    assert.ok(plan.locations.some((item: any) => item.id === scene.locationId));
    assert.ok(scene.characterIds.every((id: string) => ids.has(id)));
    assert.ok(
      scene.dialogueIds.every((id: string) => plan.dialogues.some((line: any) => line.id === id)),
    );
    return scene.shots;
  });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[0].duration + shots[1].duration, 240);
  assert.equal(shots[1].from, shots[0].duration);
  assert.equal(new Set(shots.map((shot: any) => shot.id)).size, 2);
  for (const key of ['characters', 'locations', 'props', 'scenes', 'dialogues'])
    assert.equal(plan.counters[key], plan[key].length);
  assert.equal(plan.counters.shots, 2);
  for (const line of plan.dialogues) {
    assert.ok(ids.has(line.speakerId));
    const linePcm = pcm(await file(line.file));
    assert.ok(Math.abs(linePcm.length / 48000 - line.duration) < 0.001);
    assert.ok(line.timelineStart >= 0 && line.timelineStart + line.duration <= 8);
    assert.ok(line.words.length > 0);
    let end = 0;
    for (const word of line.words) {
      const bytes = pcm(await file(word.file));
      assert.ok(word.start >= end - 0.00001 && word.end > word.start);
      assert.ok(Math.abs(word.end - word.start - bytes.length / 48000) < 0.001);
      const offset = Math.round(word.start * 24000) * 2;
      assert.deepEqual(
        linePcm.subarray(offset, offset + bytes.length),
        bytes,
        'Word timing must locate the actual source samples in the line',
      );
      end = word.end;
    }
  }
  return plan;
}
async function finished() {
  assert.equal(await exits.at(-1), 0);
  for (let i = 0; i < 100; i++) {
    const current = await store.projects.read(project.id);
    if (current.agents[0].runStatus === 'ready') return current;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error('Real outputs did not receive validated completion');
}
const timer = setTimeout(
  () => {
    console.error('Voice QA deadline reached');
    for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  },
  Math.max(1, deadline - Date.now()),
);
let success = false;
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, model: agent.model!.id }));
  if (continuation) {
    const internal = host as unknown as {
      open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
    };
    await internal.open(
      { projectId: project.id, agentId: agent.id, autoContinue: false },
      'Reset the three initial dialogue lines to a clean measured baseline in this same dialogue. The initial attempt cut the flower tail; a later revision overwrote d2.wav instead of creating a new take. Fix the baseline now; the next explicit task will test preservation again. Keep all three speakers, but shorten lines to fit completely with pauses, e.g. narrator "Смотри!" at 0, girl "Держи воду!" at 2.5, flower "Спасибо!" at 5.8. Measure actual audio and ensure every timelineStart+duration <=8, no truncated tail. Preserve exact sample-based segmented word timing, separate word/line WAVs and two actual takes of the girl line. Explicit takes.json schema is {dialogueId:<girl line ID>,takes:[{file,rate}],selected:<file>}. Copy the actual generation source into output/render.py and ensure it operates on these output files. Keep character/scene/shot IDs and the original input. Regenerate all affected stems, animatic, captions/final film and metadata; preserve the original task requirements, validate_video_project and complete_stage after checking actual audio lengths. Do not change app code or inspect other projects.',
    );
  } else
    await host.launch({
      projectId: project.id,
      agentId: agent.id,
      autoContinue: false,
      firstMessage: task,
    });
  const initial = await finished();
  const plan = await readPlan();
  const take = await json('takes.json');
  assert.ok(plan.dialogues.some((line: any) => line.id === take.dialogueId));
  assert.ok(Array.isArray(take.takes) && take.takes.length >= 2);
  assert.equal(new Set(take.takes.map((item: any) => item.rate)).size, take.takes.length);
  const takes = await Promise.all(
    take.takes.map(async (item: any) => digest(await readFile(await file(item.file)))),
  );
  assert.equal(new Set(takes).size, take.takes.length);
  const beforeHash = new Map<string, string>();
  for (const line of plan.dialogues)
    for (const path of [line.file, ...line.words.map((word: any) => word.file)])
      beforeHash.set(path, digest(await readFile(await file(path))));
  const originalFilm = digest(await readFile(join(output, 'film.mp4')));
  const originalVisual = digest(await readFile(join(output, 'visual.mp4')));
  const session = join(directory, initial.agents[0].session!.path);
  const transcript = await readFile(session, 'utf8');
  const target = plan.dialogues.find((line: any) => line.id === take.dialogueId);
  console.log(
    JSON.stringify({
      phase: 'initial-valid',
      lines: plan.dialogues.length,
      wordSampleAlignment: true,
    }),
  );
  const followup = `Revise ONLY dialogue ${target.id} in this exact dialogue: replace its text with "Расти, цветок!". Keep its speaker, keep EVERY other dialogue audio/word file byte-for-byte and all previous take files intact. Synthesize to a NEW file revision_${target.id}.wav and NEW word files prefixed revision_${target.id}; NEVER write the old target line/word/take paths. Preserve alternate take files as well. Before executing, inspect your existing script: do NOT rerun its initial-generation section because that overwrites old takes. Write a separate output/revise.py to load current metadata, add the new take, and rebuild only the affected speech stem, captions, final mix/film and animatic. Update production.json/takes.json and actual word times. Old take samples/paths remain available; the selected file changes to the NEW revision file. The silent visual.mp4 and ambience/effects/music stems must remain byte-for-byte unchanged. Keep 8 seconds/240 frames/1080x1920/30fps and existing stable scene/character/location IDs. Demonstrate semantic shot editing in shot-edits.json: split the second shot into two fresh persistent IDs, then merge them back to the original second-shot ID, preserving the split IDs in aliases/events; first-shot ID/order unchanged. Add dependency-events.json with the actual old/new line file hashes and affected stale dependencies before regeneration, followed by ready after regenerating. This is an agent-owned data log, not an app UI status. Remove the watering-can prop from project scene propIds and record its removed ID in shot-edits.json; retain the source drawing/input media (no deletion of library/source assets). Do not change global profiles, start another dialogue or edit application code. Get contract, validate_video_project, check actual files, complete_stage.`;
  const fixedStems = await Promise.all(
    ['ambience', 'effects', 'music'].map(
      async (name) => [name, digest(await readFile(join(output, 'stems', name + '.wav')))] as const,
    ),
  );
  const internal = host as unknown as {
    open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
  };
  await internal.open({ projectId: project.id, agentId: agent.id, autoContinue: false }, followup);
  const updated = await finished();
  assert.equal(updated.agents[0].session!.path, initial.agents[0].session!.path);
  const revised = await readPlan();
  const revisedLine = revised.dialogues.find((line: any) => line.id === target.id);
  assert.equal(revisedLine.text, 'Расти, цветок!');
  assert.notEqual(revisedLine.file, target.file);
  for (const [path, hash] of beforeHash)
    assert.equal(
      digest(await readFile(await file(path))),
      hash,
      'Earlier dialogue takes/words are preserved',
    );
  for (const line of plan.dialogues.filter((line: any) => line.id !== target.id))
    assert.deepEqual(
      revised.dialogues.find((item: any) => item.id === line.id),
      line,
    );
  assert.equal(digest(await readFile(join(output, 'visual.mp4'))), originalVisual);
  for (const [name, hash] of fixedStems)
    assert.equal(digest(await readFile(join(output, 'stems', name + '.wav'))), hash);
  assert.deepEqual(revised.characters, plan.characters);
  assert.deepEqual(revised.locations, plan.locations);
  assert.deepEqual(
    revised.scenes.flatMap((scene: any) => scene.shots.map((shot: any) => shot.id)),
    plan.scenes.flatMap((scene: any) => scene.shots.map((shot: any) => shot.id)),
  );
  const edits = await json('shot-edits.json');
  const originalSecondShot = plan.scenes.flatMap((scene: any) => scene.shots)[1];
  assert.equal(edits.originalSecondShotId, originalSecondShot.id);
  assert.equal(edits.merge.to, originalSecondShot.id);
  assert.equal(new Set(edits.split.map((shot: any) => shot.id)).size, 2);
  assert.deepEqual(
    edits.merge.from,
    edits.split.map((shot: any) => shot.id),
  );
  assert.deepEqual(edits.aliases, edits.merge.from);
  assert.equal(edits.split[0].from, originalSecondShot.from);
  assert.equal(edits.split[1].from, edits.split[0].from + edits.split[0].duration);
  assert.equal(edits.split[0].duration + edits.split[1].duration, originalSecondShot.duration);
  assert.ok(revised.scenes.every((scene: any) => !scene.propIds.includes(edits.removedPropId)));
  assert.ok(await file('input/source.mp4'));
  const dependency = await json('dependency-events.json');
  // Check the actual phase/hash transition, not whether a particular adjective appears.
  const invalidated = dependency.events.find((event: any) => event.stage === 'before-regeneration');
  const regenerated = dependency.events.find((event: any) => event.stage === 'after-regeneration');
  assert.ok(invalidated.affectedDependencies.includes(target.id));
  assert.ok(invalidated.affectedDependencies.includes('film'));
  assert.equal(invalidated.old[target.file], beforeHash.get(target.file));
  assert.equal(invalidated.new, null);
  assert.equal(
    regenerated.new[revisedLine.file],
    digest(await readFile(await file(revisedLine.file))),
  );
  assert.equal(regenerated.ready, true);
  const soundPlan = await json('sound-plan.json');
  const layers = ['speech', 'ambience', 'effects', 'music'];
  assert.deepEqual(
    [...new Set(soundPlan.sounds.map((item: any) => item.layer))].sort(),
    [...layers].sort(),
  );
  for (const sound of soundPlan.sounds) {
    await file(sound.file);
    assert.ok(sound.start >= 0 && sound.duration > 0 && sound.start + sound.duration <= 8.05);
    assert.ok(sound.volume >= 0 && sound.pan >= -1 && sound.pan <= 1);
  }
  const stemHashes = [];
  for (const name of layers) {
    const samples = pcm(join(output, 'stems', name + '.wav'), 2);
    assert.equal(samples.length, 8 * 24000 * 2 * 2);
    let peak = 0,
      sum = 0;
    for (let i = 0; i < samples.length; i += 2) {
      const value = samples.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }
    assert.ok(peak > 0.001 && peak < 0.999, name + ' must contain non-clipped audio');
    assert.ok(Math.sqrt(sum / (samples.length / 2)) > 0.0001);
    stemHashes.push(digest(samples));
  }
  assert.equal(new Set(stemHashes).size, 4);
  const document = await readVideoProject(
    directory,
    project.id,
    `${project.agents[0].outputPath}/film.pistudio.json`,
  );
  assert.deepEqual(
    [
      document.timeline.width,
      document.timeline.height,
      document.timeline.fps,
      document.timeline.durationInFrames,
    ],
    [1080, 1920, 30, 240],
  );
  assert.equal(document.timeline.tracks.filter((track) => track.type === 'audio').length, 4);
  assert.ok(
    document.timeline.tracks.some((track) => track.type === 'subtitles' && track.items.length >= 3),
  );
  for (const name of ['film.mp4', 'animatic.mp4']) {
    const path = join(output, name);
    const probe = JSON.parse(
      execFileSync(
        '/opt/homebrew/bin/ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
        { encoding: 'utf8' },
      ),
    );
    const video = probe.streams.find((stream: any) => stream.codec_type === 'video');
    assert.deepEqual(
      [video.width, video.height, video.avg_frame_rate, Number(video.nb_frames)],
      [1080, 1920, '30/1', 240],
    );
    assert.ok(probe.streams.some((stream: any) => stream.codec_type === 'audio'));
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], {
      timeout: 20000,
      stdio: 'pipe',
    });
  }
  const animaticFrame = (frame: number) =>
    execFileSync('/opt/homebrew/bin/ffmpeg', [
      '-v',
      'error',
      '-i',
      join(output, 'animatic.mp4'),
      '-vf',
      `select=eq(n\\,${frame}),scale=54:96`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-',
    ]);
  const draftFrames = [30, 60, 150, 180].map(animaticFrame);
  assert.deepEqual(draftFrames[0], draftFrames[1], 'First animatic shot is a held image');
  assert.deepEqual(draftFrames[2], draftFrames[3], 'Second animatic shot is a held image');
  assert.notDeepEqual(draftFrames[0], draftFrames[2], 'Animatic has two distinct shot images');
  const filmHash = digest(await readFile(join(output, 'film.mp4')));
  assert.notEqual(filmHash, originalFilm);
  const after = await readFile(session, 'utf8');
  const users = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => line.type === 'message' && line.message?.role === 'user').length;
  assert.equal(users(after), users(transcript) + 1);
  await host.launch({ projectId: project.id, agentId: agent.id, autoContinue: false });
  assert.equal(await exits.at(-1), 0);
  assert.equal(await readFile(session, 'utf8'), after);
  assert.equal(digest(await readFile(join(output, 'film.mp4'))), filmHash);
  let bytes = 0;
  async function size(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const full = join(path, entry.name);
      if (entry.isDirectory()) await size(full);
      else bytes += (await stat(full)).size;
    }
  }
  await size(output);
  assert.ok(bytes < 24 * 1024 ** 2);
  const artifact = resolve('artifacts/voice-workflow');
  await rm(artifact, { recursive: true, force: true });
  await cp(output, artifact, { recursive: true, filter: (path) => path !== join(output, 'input') });
  await writeFile(
    join(artifact, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: JSON.parse(await readFile('package.json', 'utf8')).version,
        actualPi: pi.version,
        model: agent.model!.id,
        actualAgentBashRender: true,
        sha256: filmHash,
        isolatedQaOnly: true,
        paidMediaApiCalls: 0,
        desktopAudioPlayback: false,
        initialTaskCorrectedInRetainedDialogue: continuation,
        threeAssignedSpeakers: true,
        separateDialogueFiles: true,
        actualSegmentedWordSampleAlignment: true,
        alternateTakes: true,
        oneLineRevisedInExactDialogue: true,
        earlierTakesAndOtherLinesUnchanged: true,
        visualAndOtherStemsUnchanged: true,
        fourDistinctFullLengthStems: true,
        originalAndRevisedMovieDiffer: true,
        stableSceneAndShotIds: true,
        agentOwnedSplitMergeAndDependencyLog: true,
        explicitIdleResumeWithoutReplay: true,
        validatedBundledViewerContract: true,
        completeFfmpegDecode: true,
        outputBytes: bytes,
        twoDistinctStaticAnimaticShots: true,
        limits:
          'Actual local macOS segmented TTS, not continuous-speech forced alignment or a subjective voice/animation quality assessment. Domain planning/stale logs are agent-owned files, not automatic Studio production screens. Native viewer checked separately. Input art came from prior real QA generation; no user data or OS permissions changed.',
      },
      null,
      2,
    ) + '\n',
  );
  success = true;
  console.log(JSON.stringify({ phase: 'passed', artifact, outputBytes: bytes }));
} finally {
  clearTimeout(timer);
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  if (success) await rm(root, { recursive: true, force: true });
  else console.log('Disposable failed QA retained for inspection: ' + root);
}
