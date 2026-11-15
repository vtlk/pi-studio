import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, cp, rm } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { readVideoProject } from '../src/main/video/readVideoProject.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Opt-in production Pi request. Seed only our committed QA media, never a user studio.
// Keep a failed temporary project/session for an exact targeted correction, not resynthesis.
const continuation = process.argv.indexOf('--continue');
const metadataOnly = process.argv.includes('--metadata-only');
const root =
  continuation >= 0
    ? process.argv[continuation + 1]
    : await mkdtemp(join(tmpdir(), 'pistudio-voice-polish-'));
assert.match(basename(root), /^pistudio-voice-polish-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const artifact = resolve('artifacts/voice-workflow');
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const profile: Agent = {
  id: 'delivery',
  name: 'Проверка титров и атмосферы',
  enabled: true,
  skills: [],
  mcps: [],
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
    'You are the final delivery artist in a disposable Pi Studio QA project. Use native bash and production project MCP to fix actual media. Work only in your output. No application source, credentials, other projects, network/media APIs, dependencies, backups or desktop audio playback. Never fake a result or claim success from metadata alone. Use validate_video_project then complete_stage with the actual final files, or report_blocked on a real obstacle.',
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
  await store.command({ kind: 'create', name: 'Доставка мультфильма — QA', agents: [profile] });
}
const project = store.bootstrap().projects[0],
  directory = await store.projects.directory(project.id);
const output = join(directory, project.agents[0].outputPath);
await mkdir(output, { recursive: true });
if (continuation < 0) await cp(artifact, output, { recursive: true });
async function fingerprints(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const full = join(path, entry.name);
    if (entry.isDirectory())
      for (const [key, value] of Object.entries(await fingerprints(full)))
        result[join(entry.name, key)] = value;
    else result[entry.name] = hash(await readFile(full));
  }
  return result;
}
const observationFile = join(root, 'observations.json');
if (continuation < 0)
  await writeFile(
    observationFile,
    JSON.stringify({
      before: await fingerprints(output),
      priorProof: JSON.parse(await readFile(join(output, 'proof.json'), 'utf8')),
    }),
  );
const observation = JSON.parse(await readFile(observationFile, 'utf8'));
const task = `Polish this existing QA cartoon, whose deliverables are already in your output. Do NOT rerun render.py or revise.py: they contain the mistakes being tested. Make a new polish.py, using current production.json/timeline.json as inputs. No need for new voices or new artwork.

1. The lower panel of visual.mp4 is only 78% opaque, so old source captions show through. Make it fully opaque black at y=1500..1919 (1080x420) in the otherwise unchanged moving visual.mp4. Keep it silent and WITHOUT new burned text, since the bundled Player supplies timeline subtitles. Use this clean visual for the final export. Upper artwork must remain visually unchanged.
2. film.mp4 currently does not burn its new captions. Render the THREE current uppercase lines from production.json or the validated timeline into final film.mp4 exactly once, in the same lower panel at the current times (0..2.5, 2.5..5.8, 5.8..8). The new texts are СМОТРИ!, РАСТИ, ЦВЕТОК!, СПАСИБО! Do not retain old source captions or accidentally add viewer captions twice. Use Pillow with an installed Cyrillic font to create transparent caption PNG overlays if ffmpeg lacks libass/drawtext. Keep caption PNGs in captions/ for visual review. The exported MP4 needs real readable pixels, not just an ASS file or a subtitle track in metadata.
3. stems/ambience.wav is 0.17/0.31Hz sub-audible tones. Replace only that stem with quiet audible garden wind/rustle, e.g. deterministic band-limited noise mostly 180..2500Hz. Exactly 8s stereo 24000Hz PCM s16le, no clipping, above-80Hz RMS between 0.002 and 0.03. Avoid a DC/sub-bass substitute. Preserve speech/effects/music stems, every old/current voice/word/take WAV, production.json and takes.json BYTE-FOR-BYTE.
4. Rebuild film.mp4 with the NEW ambience and unchanged other three stems summed at their existing full gains (no automatic 1/4 normalization). Keep the same H.264 yuv420p/AAC, 1080x1920/30fps/240frames/8s. Rebuild animatic.mp4 from two static clean held shot images with the existing speech and pauses; keep its audio. Update sound-plan/mix-report and any needed source/preview data. Preserve sound-plan's sounds array, with one source/start/duration/volume/pan entry per actual stem and the water actionId; do not replace it with only a list of labels. Timeline keeps separate silent clean visual, FOUR stem tracks and ONE current subtitles track; do not replace them all with a flattened movie. Record real measurements in delivery-report.json.
5. Read the current video contract, validate the actual manifest/assets, ffprobe/decode both movies, inspect the caption PNGs and final frames. Do not play audio. Complete with film.mp4, visual.mp4, animatic.mp4, stems/ambience.wav, timeline.json, film.pistudio.json, polish.py and delivery-report.json. All work stays in your output and under 24MiB. No approval gate, paid media call, dependency install or app-code edit.`;
const processes: ReturnType<typeof spawn>[] = [],
  exits: Promise<number | null>[] = [];
const pi = await checkPi('');
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
const timeout = setTimeout(() => {
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
}, 8 * 60_000);
const ffmpeg = (args: string[]) =>
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', ...args], { maxBuffer: 8 * 1024 ** 2 });
const pixels = (file: string, frame: number, crop: string) =>
  ffmpeg([
    '-i',
    file,
    '-vf',
    `select=eq(n\\,${frame}),${crop}`,
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-',
  ]);
const floats = (file: string, filter?: string) =>
  ffmpeg([
    '-i',
    file,
    ...(filter ? ['-af', filter] : []),
    '-ar',
    '24000',
    '-ac',
    '2',
    '-f',
    'f32le',
    '-',
  ]);
let passed = false;
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, continuation: continuation >= 0 }));
  const request = { projectId: project.id, agentId: profile.id, autoContinue: false };
  const beforeMetadata = metadataOnly ? await fingerprints(output) : undefined;
  if (continuation >= 0)
    await (
      host as unknown as {
        open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
      }
    ).open(
      request,
      metadataOnly
        ? 'One metadata-only correction in this exact dialogue: the media polish succeeded, but you replaced sound-plan.json sounds entries with mere stem labels. Change ONLY sound-plan.json; every other file including WAV/MP4/PNG/source/production/takes/timeline/manifest/report must remain byte-identical. Restore {sounds:[{id,layer,file,start,duration,volume,pan,actionId?}]} with the four actual stems at start 0,duration 8,volume 1,pan 0 because gains/pans are already baked into those WAVs. Use relative stems/*.wav paths and the current watering action ID from production.json for effects. You may retain the new descriptive fields, but the actual source/timing/mix fields are required. Read the current timeline/production files, check every path/ID, validate the unchanged video project and complete_stage with sound-plan.json. No synthesis, media rerender or edits to other files.'
        : 'Continue the same explicit polish task. Read qa-findings.json for the failed actual-media check, fix only the issue and preserve protected files. ' +
            task,
    );
  else await host.launch({ ...request, firstMessage: task });
  assert.equal(await exits.at(-1), 0);
  const updated = await store.projects.read(project.id);
  assert.equal(updated.agents[0].runStatus, 'ready');
  const after = await fingerprints(output);
  if (beforeMetadata)
    for (const [name, digest] of Object.entries(beforeMetadata))
      if (name !== 'sound-plan.json')
        assert.equal(after[name], digest, 'Metadata correction changed ' + name);
  const soundPlan = JSON.parse(await readFile(join(output, 'sound-plan.json'), 'utf8'));
  assert.ok(Array.isArray(soundPlan.sounds));
  assert.deepEqual(soundPlan.sounds.map((sound: any) => sound.layer).sort(), [
    'ambience',
    'effects',
    'music',
    'speech',
  ]);
  for (const sound of soundPlan.sounds) {
    assert.equal(sound.file, 'stems/' + sound.layer + '.wav');
    assert.deepEqual([sound.start, sound.duration, sound.volume, sound.pan], [0, 8, 1, 0]);
  }
  const production = JSON.parse(await readFile(join(output, 'production.json'), 'utf8'));
  assert.ok(
    production.scenes.some((scene: any) =>
      scene.shots.some((shot: any) =>
        shot.actionIds.includes(
          soundPlan.sounds.find((sound: any) => sound.layer === 'effects').actionId,
        ),
      ),
    ),
  );
  const protectedFiles = Object.keys(observation.before).filter(
    (name) =>
      name.startsWith('words/') ||
      /^d\d.*\.wav$/.test(name) ||
      name === 'revision_d2.wav' ||
      [
        'production.json',
        'takes.json',
        'stems/speech.wav',
        'stems/music.wav',
        'stems/effects.wav',
      ].includes(name),
  );
  for (const name of protectedFiles)
    assert.equal(after[name], observation.before[name], 'Protected media changed: ' + name);
  assert.ok(after['polish.py'] && after['delivery-report.json']);
  if (observation.priorProof.remainingCreativeIssues?.length) {
    assert.notEqual(after['film.mp4'], observation.before['film.mp4']);
    assert.notEqual(after['stems/ambience.wav'], observation.before['stems/ambience.wav']);
  }
  const cropMetrics = [];
  for (const frame of [30, 90, 190]) {
    const black = pixels(join(output, 'visual.mp4'), frame, 'crop=1040:380:20:1520');
    assert.ok(
      Math.max(...black.subarray(0, 100000)) <= 4,
      'Visual lower panel must be opaque black',
    );
    assert.ok(
      black.every((value) => value <= 4),
      'Old captions must not ghost through any lower-panel pixel',
    );
    const caption = pixels(join(output, 'film.mp4'), frame, 'crop=1080:420:0:1500');
    let white = 0;
    for (let i = 0; i < caption.length; i += 3)
      if (caption[i] > 180 && caption[i + 1] > 180 && caption[i + 2] > 180) white++;
    assert.ok(
      white > 1500,
      'Export must contain actual readable new caption pixels at frame ' + frame,
    );
    const top = pixels(join(output, 'visual.mp4'), frame, 'crop=1080:1400:0:0,scale=108:140');
    const previous = pixels(
      join(artifact, 'visual.mp4'),
      frame,
      'crop=1080:1400:0:0,scale=108:140',
    );
    const distance =
      top.reduce((sum, value, i) => sum + Math.abs(value - previous[i]), 0) / top.length;
    assert.ok(distance < 2, 'Upper artwork changed');
    cropMetrics.push({ frame, whiteCaptionPixels: white, upperMeanDifference: distance });
    ffmpeg([
      '-y',
      '-i',
      join(output, 'film.mp4'),
      '-vf',
      `select=eq(n\\,${frame}),crop=1080:420:0:1500`,
      '-frames:v',
      '1',
      join(output, `caption-check-${frame}.png`),
    ]);
  }
  const ambience = floats(join(output, 'stems/ambience.wav'), 'highpass=f=80');
  assert.equal(ambience.length, 8 * 24000 * 2 * 4);
  let squares = 0,
    peak = 0;
  for (let i = 0; i < ambience.length; i += 4) {
    const value = ambience.readFloatLE(i);
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const audibleRms = Math.sqrt(squares / (ambience.length / 4));
  assert.ok(
    audibleRms >= 0.002 && audibleRms <= 0.03 && peak < 0.99,
    'Audible ambience RMS/peak: ' + audibleRms + '/' + peak,
  );
  const stems = ['speech', 'ambience', 'effects', 'music'].map((name) =>
    floats(join(output, 'stems', name + '.wav')),
  );
  const actualMix = floats(join(output, 'film.mp4'));
  assert.ok(actualMix.length >= stems[0].length);
  let xy = 0,
    xx = 0,
    errorSquares = 0;
  for (let i = 0; i < stems[0].length; i += 4) {
    const expected = stems.reduce((sum, bytes) => sum + bytes.readFloatLE(i), 0),
      actual = actualMix.readFloatLE(i);
    xx += expected * expected;
    xy += expected * actual;
    errorSquares += (actual - expected) ** 2;
  }
  const mixGain = xy / xx,
    mixErrorRms = Math.sqrt(errorSquares / (stems[0].length / 4));
  assert.ok(
    mixGain > 0.8 && mixGain < 1.2 && mixErrorRms < 0.01,
    'Export mix differs from the actual four stems: gain=' + mixGain + ', RMS=' + mixErrorRms,
  );
  const document = await readVideoProject(
    directory,
    project.id,
    project.agents[0].outputPath + '/film.pistudio.json',
  );
  assert.equal(document.timeline.tracks.filter((track) => track.type === 'audio').length, 4);
  assert.equal(document.timeline.tracks.filter((track) => track.type === 'subtitles').length, 1);
  for (const name of ['film.mp4', 'animatic.mp4']) {
    const probe = JSON.parse(
      execFileSync(
        '/opt/homebrew/bin/ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(output, name)],
        { encoding: 'utf8' },
      ),
    );
    const video = probe.streams.find((stream: any) => stream.codec_type === 'video');
    assert.deepEqual(
      [video.width, video.height, video.avg_frame_rate, Number(video.nb_frames)],
      [1080, 1920, '30/1', 240],
    );
    assert.ok(probe.streams.some((stream: any) => stream.codec_type === 'audio'));
    assert.ok(Math.abs(Number(probe.format.duration) - 8) < 0.15);
    ffmpeg(['-i', join(output, name), '-f', 'null', '-']);
  }
  const session = join(directory, updated.agents[0].session!.path),
    transcript = await readFile(session, 'utf8');
  const finalHashes = await fingerprints(output);
  await host.launch(request);
  assert.equal(await exits.at(-1), 0);
  assert.equal(await readFile(session, 'utf8'), transcript);
  assert.deepEqual(await fingerprints(output), finalHashes);
  const proof = {
    checkedAt: new Date().toISOString(),
    version: '0.2.0-alpha.60',
    actualPi: pi.version,
    model: profile.model!.id,
    actualAgentBashRender: true,
    sha256: finalHashes['film.mp4'],
    paidMediaApiCalls: 0,
    desktopAudioPlayback: false,
    priorVoiceRun: observation.priorProof,
    newExplicitQaDeliveryProject: true,
    protectedVoiceAndThreeStemsUnchanged: true,
    opaquePanelAndBurnedCaptions: cropMetrics,
    audibleBandAmbienceRmsAbove80Hz: audibleRms,
    exportMixGainAgainstActualStems: mixGain,
    exportMixErrorRms: mixErrorRms,
    fourSeparateAudioTracks: true,
    actualSourceTimingGainPanAndActionPlan: true,
    ...(metadataOnly ? { metadataOnlyCorrectionPreservedAllOtherFiles: true } : {}),
    completeFfmpegDecode: true,
    exactIdleResumeWithoutReplay: true,
    remainingCreativeIssues: [],
    limits:
      'Current caption/mix repair in a new disposable production-Pi project seeded only with our prior QA outputs. Earlier voice changes belong to priorVoiceRun, not this dialogue. Native viewer/visual review still checked separately; no subjective pronunciation, continuous forced alignment, Computer GUI grants or user Keychain proof.',
  };
  await writeFile(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  await rm(artifact, { recursive: true, force: true });
  await cp(output, artifact, { recursive: true });
  passed = true;
  console.log(JSON.stringify({ phase: 'passed', audibleRms, mixGain, mixErrorRms, cropMetrics }));
} catch (error) {
  await writeFile(
    join(output, 'qa-findings.json'),
    JSON.stringify({ error: String(error), checkedAt: new Date().toISOString() }, null, 2),
  );
  throw error;
} finally {
  clearTimeout(timeout);
  host.close();
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.allSettled(exits);
  if (!passed) console.log('Disposable QA retained for exact continuation: ' + root);
  // Successful root also stays until native viewer and visual review finish.
}
