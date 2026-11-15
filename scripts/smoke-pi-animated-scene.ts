import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { readVideoProject } from '../src/main/video/readVideoProject.ts';
import { validateCompletedOutputs } from '../src/main/pi/completeStage.ts';
import { qaLibraryPreview } from './qa-library-preview.ts';
import { qaToolScope } from './qa-tool-scope.ts';
import { parseCharacterSvg } from '../src/shared/characterSvg.ts';
import type { SvgNode } from '../src/shared/characterRig.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Opt-in real Pi animation. Generated scripts run only in the agent's native bash;
// Studio receives validated inert library data and media, never executable viewer code.
const continuation = process.argv.indexOf('--continue');
const verifyOnly = process.argv.includes('--verify-only');
const requestFileIndex = process.argv.indexOf('--request-file');
const correctionRequest =
  requestFileIndex >= 0 ? await readFile(process.argv[requestFileIndex + 1], 'utf8') : undefined;
assert.ok(!correctionRequest || (continuation >= 0 && !verifyOnly));
assert.ok(!verifyOnly || continuation >= 0);
const root =
  continuation >= 0
    ? process.argv[continuation + 1]
    : await mkdtemp(join(tmpdir(), 'pistudio-animated-scene-'));
assert.match(basename(root), /^pistudio-animated-scene-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const artifact = resolve('artifacts/animated-scene');
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const ruby = JSON.parse(await readFile('artifacts/library-lifecycle/proof.json', 'utf8'));
const terrace = JSON.parse(await readFile('artifacts/scene-plan/proof.json', 'utf8'));
const profile: Agent = {
  id: 'animator',
  name: 'Речь и анимация',
  enabled: true,
  skills: [],
  mcps: ['pistudio-library'],
  plugins: ['qa-tool-scope'],
  instructions: [],
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Средний',
    temperature: '',
  },
  mainInstruction:
    'You are an actual animation artist in disposable Pi Studio QA. Use assigned production Library/Project MCP and native bash. Work only in your output or main-owned preparation directories. No application source, credentials, unrelated projects, downloads, dependencies, browser/computer tools, paid media APIs, backups or desktop playback. Preserve published assets byte-for-byte. Do not pretend a JSON description is an animation. Use real data, render/check media, validate_video_project and complete_stage, or report_blocked for a real obstacle. No approval gate.',
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
  await cp(
    resolve('artifacts/library-lifecycle/versions'),
    join(store.folder, 'library/characters', ruby.assetId, 'versions'),
    { recursive: true },
  );
  await cp(
    resolve('artifacts/scene-plan/versions'),
    join(store.folder, 'library/locations', terrace.locationId, 'versions'),
    { recursive: true },
  );
  await store.command({ kind: 'create', name: 'Фонарь — говорящий персонаж', agents: [profile] });
}
const project = store.bootstrap().projects[0],
  directory = await store.projects.directory(project.id);
const output = join(directory, project.agents[0].outputPath);
await mkdir(output, { recursive: true });
const toolScope = await qaToolScope(root, output);
await store.saveSection('resources', [toolScope.resource]);
await store.saveSection('agents', [profile]);
// Existing projects retain resource assignments until an explicit refresh.
// Apply this owned QA-only package to the snapshot as well as the constructor.
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
async function fingerprint(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const full = join(path, entry.name);
    if (entry.isDirectory())
      for (const [name, digest] of Object.entries(await fingerprint(full)))
        result[join(entry.name, name)] = digest;
    else result[entry.name] = hash(await readFile(full));
  }
  return result;
}
const observations = join(root, 'observations.json');
if (continuation < 0)
  await writeFile(
    observations,
    JSON.stringify({ library: await fingerprint(join(store.folder, 'library')) }),
  );
const baseline = JSON.parse(await readFile(observations, 'utf8'));
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
}, 12 * 60_000);
const task = `Make one real 8-second portrait cartoon from these PINNED library sources: character ${ruby.assetId} version 3 (Руби), location ${terrace.locationId} version 1 (terrace). Read them through library_get_asset and read the library/video contracts. Keep every published file unchanged; do not publish a new library version. All rendering is your native bash work, not app/viewer code.

Story: Руби says "Этот фонарь поможет путникам", then puts a red lantern from her hand onto the bench, gives a short wave, smiles/tilts her head; finish with a gentle camera move and real differential background/foreground parallax. Preserve the original character and terrace appearance. Keep a clear, readable composition, sun/bench/blue torso badge visible throughout. There is no dog in this scene.

A. First synthesize the ONE continuous Russian line using /usr/bin/say -v Milena -r 175 -o temporary.aiff, convert with installed ffmpeg to mono 24000Hz PCM s16le voice.wav. No playback. Measure actual samples/duration before choosing shot timing. Voice begins at offsetSeconds=0.4; whole line must end before 5s, shorten speaking duration by explicit rate if needed. Do not estimate timing from text. Write speech.json:{file:"voice.wav",offsetSeconds:0.4,durationSeconds:<actual>,sampleRate:24000,rmsPerFrame:[240 actual global-frame RMS values]}. For frame f, take voice samples f*800-9600 .. (f+1)*800-9600, zero outside voice, normalize PCM by32768, RMS over all800 samples.

B. Make a PROJECT-ONLY costume/pose variant: green scarf fill #16A36A with data-part="project-scarf", and visibly bent-elbow right-arm base geometry. Keep all original required SVG/rig parts, blue badge visible, all six action/eight emotion data valid. Use library_prepare_asset existingId only as an owned validation staging area, copy original reference/SVG/rig there, add scarf/pose, obtain trusted library_render_preview and library_validate_asset. DO NOT publish. Copy just valid SVG/rig to variants/ruby/character.svg and rig.json, and the trusted control PNG to variant-preview.png. Record variant.json:{base:{kind:"characters",id:<id>,version:3},vector:"variants/ruby/character.svg",rig:"variants/ruby/rig.json"}. No instructions or executable preview scripts in asset packages.

C. Animate the ACTUAL SVG/rig artwork using a source render.py (Pillow/CairoSVG/stdlib/ffmpeg already installed). Stream frames or delete your own intermediates; stay below24MiB. 1080x1920/30fps/240frames. During all frames0..speechEndFrame+11 keep actor BODY/HEAD position and camera fixed: mouth only follows the real audio envelope, gaze/eyelids may move. Make mouth filled/stroked burgundy #8C1D40 so it visibly opens on speech and closes on silence; no fake markers. Schedule left-eye pupil looking left at frame18 and right at30. Both eyes open at44, fully closed at48 with skin-colored original lids covering the whites/pupils, open again at54. Keep head/body fixed for these facial controls. Body/scarf/badge keep original appearance. Do not replace the character with a generic new face.

After speech ends, motionStartFrame=ceil((0.4+durationSeconds)*30)+12: wave the bent arm over the next30frames and place the lantern. Keep body x fixed. Starting at cameraStartFrame=motionStartFrame+30, add smile/head tilt/breathing, camera pan/push-in and parallax. Terrace/bench and actor use foreground factor1; sky/sun move more slowly (e.g.factor0.2). This must change actual relative geometry, not merely be written in metadata. Keep the existing sun #FFF1A8, bench #70452D and badge #2F80ED visible, so output pixels can be checked against an affine camera transform. Lantern fill #D33644 must be distinguishable from the red torso; preserve it as a real moving prop. Put it on the bench before the late camera comparison. No large actor x translation to fake parallax.

D. Write animation.json with mouthBox,eyesBox,leftEyeBox,waveBox as [x,y,width,height] absolute video pixel bounds (mouth<=300x200, eyes<=400x200, each leftEye<=180x180, all boxes tight around actual parts and fixed before motionStart); motionStartFrame,cameraStartFrame; shots:[{id,from,duration,camera}] covering0..239 in order (first shot ends at cameraStartFrame, second covers the remainder); cameraKeyframes,lanternKeyframes,parallaxLayers. Choose shot boundary from the actual measured speech timing above. Use stable distinct shot IDs. Do not leave this planning step until after render; use it to render.

E. Produce silent visual.mp4 without captions, and final film.mp4 with the exact voice at0.4s and real burned uppercase line on an opaque lower caption panel that does not cover face/prop. Use proper Cyrillic font/Pillow overlays if ffmpeg has no subtitles filter. Film H.264 yuv420p/AAC/8s. Write current valid film.pistudio.json/timeline.json from get_video_contract: one silent visual track, voice audio at frame12, one subtitles track; no double audio/captions. Validate it. Also save a contact-sheet.png from actual film frames3,18,30,44,48,54, speech loudest frame and late action/camera frames for review. Check actual output with ffprobe/full decode. Complete with voice.wav,speech.json,animation.json,variant.json,variant-preview.png,render.py,visual.mp4,film.mp4,film.pistudio.json,timeline.json,contact-sheet.png. No paid services, dependencies, approval gate or app edits.`;
const request = { projectId: project.id, agentId: profile.id, autoContinue: false };
const ffmpeg = (args: string[]) =>
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', ...args], { maxBuffer: 32 * 1024 ** 2 });
const raw = (frame: number, box: number[]) =>
  ffmpeg([
    '-i',
    join(output, 'visual.mp4'),
    '-vf',
    `select=eq(n\\,${frame}),crop=${box[2]}:${box[3]}:${box[0]}:${box[1]}`,
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-',
  ]);
const colorCount = (bytes: Buffer, color: number[], tolerance = 30) => {
  let count = 0;
  for (let i = 0; i < bytes.length; i += 3)
    if (color.every((v, c) => Math.abs(bytes[i + c] - v) < tolerance)) count++;
  return count;
};
function centroid(bytes: Buffer, width: number, color: number[], tolerance = 24) {
  let x = 0,
    y = 0,
    n = 0;
  for (let i = 0; i < bytes.length; i += 3)
    if (color.every((v, c) => Math.abs(bytes[i + c] - v) < tolerance)) {
      x += (i / 3) % width;
      y += Math.floor(i / 3 / width);
      n++;
    }
  assert.ok(n > 20, 'Missing landmark ' + color);
  return { x: x / n, y: y / n, count: n };
}
try {
  console.log(JSON.stringify({ phase: 'started', studio: root, verifyOnly }));
  if (!verifyOnly) {
    if (continuation >= 0)
      await (
        host as unknown as {
          open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
        }
      ).open(
        request,
        correctionRequest ??
          'Continue this SAME animation task and dialogue, preserving every original requirement. Read qa-findings.json. The first failed check is factual: mouth color area at a real speech peak and silence is identical (1611 pixels), so the current two-quad mouth lens bends but does not open. Correct render.py to vary the actual gap/area with the measured RMS (e.g. keep the upper curve stable and vary the lower curve with amplitude); do not merely move a fixed-thickness lens. Keep voice.wav, speech.json, measured shot schedule/IDs, the project SVG/rig variant and all published library files unchanged. Regenerate actual visual/film/contact sheet, check the other gaze/blink/arm/prop/camera/parallax requirements too. The newly assigned QA-only tool scope permits bash writes ONLY within your output; use output/.qa-tmp for all intermediates/logs. Do NOT use /tmp/contact, /tmp/render.out or generic absolute temporary paths. Use only project-local copies of pinned SVG/rig inputs, relative to render.py, for reproducible sources. Native auth remains outside this guard. No new speech synthesis, publication, app edits, dependency install, network calls or playback. Validate_video_project and complete_stage with the original deliverables after checking actual media, not just metadata.',
      );
    else await host.launch({ ...request, firstMessage: task });
    assert.equal(await exits.at(-1), 0);
    assert.equal((await store.projects.read(project.id)).agents[0].runStatus, 'ready');
  }
  const updated = await store.projects.read(project.id),
    session = join(directory, updated.agents[0].session!.path),
    transcript = await readFile(session, 'utf8');
  const messages = transcript
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.message);
  const completionMessage = messages
    .filter(
      (message) =>
        message.role === 'toolResult' &&
        message.toolName === 'mcp__pi_studio__complete_stage' &&
        !message.isError,
    )
    .at(-1);
  const completion = JSON.parse(
    completionMessage.content.find((part: any) => part.type === 'text').text,
  );
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
  assert.deepEqual(await fingerprint(join(store.folder, 'library')), baseline.library);
  assert.ok(
    !messages.some(
      (message) =>
        message.role === 'toolResult' &&
        message.toolName === 'mcp__pi_studio__library_publish_asset' &&
        !message.isError,
    ),
  );
  for (const name of [
    'library_get_asset',
    'library_prepare_asset',
    'library_render_preview',
    'library_validate_asset',
  ])
    assert.ok(
      messages.some(
        (message) =>
          message.role === 'toolResult' &&
          message.toolName === 'mcp__pi_studio__' + name &&
          !message.isError,
      ),
    );
  const variant = JSON.parse(await readFile(join(output, 'variant.json'), 'utf8'));
  assert.deepEqual(variant.base, { kind: 'characters', id: ruby.assetId, version: 3 });
  const svg = await readFile(join(output, 'variants/ruby/character.svg'), 'utf8');
  assert.ok(svg.includes('project-scarf'));
  const originalSvg = parseCharacterSvg(
      await readFile('artifacts/library-lifecycle/versions/3/character.svg', 'utf8'),
    ),
    changedSvg = parseCharacterSvg(svg);
  const geometry = (node: SvgNode): string[] => [
    ...(node.tag === 'path' ? [node.attributes.d] : []),
    ...node.children
      .filter((child): child is SvgNode => typeof child !== 'string')
      .flatMap(geometry),
  ];
  assert.notDeepEqual(
    geometry(changedSvg.parts.get('rightArm')!),
    geometry(originalSvg.parts.get('rightArm')!),
    'Project pose must change actual bent-arm geometry',
  );
  const control = ffmpeg([
    '-i',
    join(output, 'variant-preview.png'),
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-',
  ]);
  assert.ok(colorCount(control, [22, 163, 106]) > 100, 'Scarf must be visible in trusted preview');
  const speech = JSON.parse(await readFile(join(output, 'speech.json'), 'utf8')),
    animation = JSON.parse(await readFile(join(output, 'animation.json'), 'utf8'));
  assert.equal(speech.file, 'voice.wav');
  assert.equal(speech.offsetSeconds, 0.4);
  assert.equal(speech.sampleRate, 24000);
  assert.equal(speech.rmsPerFrame.length, 240);
  const voice = ffmpeg([
    '-i',
    join(output, 'voice.wav'),
    '-ar',
    '24000',
    '-ac',
    '1',
    '-f',
    's16le',
    '-',
  ]);
  const voiceDuration = voice.length / 48000;
  assert.ok(Math.abs(speech.durationSeconds - voiceDuration) < 0.001 && voiceDuration + 0.4 < 5);
  const envelope = Array.from({ length: 240 }, (_, frame) => {
    let sum = 0;
    for (let j = 0; j < 800; j++) {
      const index = frame * 800 - 9600 + j;
      if (index >= 0 && index < voice.length / 2)
        sum += (voice.readInt16LE(index * 2) / 32768) ** 2;
    }
    return Math.sqrt(sum / 800);
  });
  assert.ok(
    envelope.every((value, index) => Math.abs(value - speech.rmsPerFrame[index]) < 0.00001),
    'Envelope must come from actual samples',
  );
  assert.equal(animation.motionStartFrame, Math.ceil((0.4 + voiceDuration) * 30) + 12);
  assert.equal(animation.cameraStartFrame, animation.motionStartFrame + 30);
  assert.ok(animation.cameraStartFrame < 225);
  assert.equal(animation.shots.length, 2);
  assert.equal(new Set(animation.shots.map((shot: any) => shot.id)).size, 2);
  assert.deepEqual(
    animation.shots.map((shot: any) => [shot.from, shot.duration]),
    [
      [0, animation.cameraStartFrame],
      [animation.cameraStartFrame, 240 - animation.cameraStartFrame],
    ],
  );
  for (const [name, maxWidth, maxHeight] of [
    ['mouthBox', 300, 200],
    ['eyesBox', 400, 200],
    ['leftEyeBox', 180, 180],
  ] as const) {
    const box = animation[name];
    assert.ok(
      box.length === 4 &&
        box.every(Number.isInteger) &&
        box[0] >= 0 &&
        box[1] >= 0 &&
        box[2] > 0 &&
        box[3] > 0 &&
        box[2] <= maxWidth &&
        box[3] <= maxHeight &&
        box[0] + box[2] <= 1080 &&
        box[1] + box[3] <= 1920,
    );
  }
  const peakFrame = envelope.indexOf(Math.max(...envelope));
  assert.ok(envelope[peakFrame] > 0.01);
  const silentMouth = colorCount(raw(3, animation.mouthBox), [140, 29, 64]),
    voicedMouth = colorCount(raw(peakFrame, animation.mouthBox), [140, 29, 64]);
  assert.ok(
    voicedMouth > silentMouth * 1.5 + 30,
    'Mouth must actually open on the measured speech peak: ' + silentMouth + ' -> ' + voicedMouth,
  );
  const eyePixels = [44, 48, 54].map((frame) =>
    colorCount(raw(frame, animation.eyesBox), [255, 255, 255], 30),
  );
  assert.ok(
    eyePixels[0] > 100 && eyePixels[1] < eyePixels[0] * 0.15 && eyePixels[2] > eyePixels[0] * 0.7,
    'Original lids must close/reopen eyes: ' + eyePixels,
  );
  const pupils = [18, 30].map((frame) =>
    centroid(raw(frame, animation.leftEyeBox), animation.leftEyeBox[2], [34, 34, 34], 22),
  );
  assert.ok(pupils[1].x > pupils[0].x + 3, 'Gaze must move the actual pupil');
  const lanternPositions = [30, animation.cameraStartFrame - 1].map((frame) =>
    centroid(raw(frame, [0, 0, 1080, 1500]), 1080, [211, 54, 68], 20),
  );
  assert.ok(
    Math.hypot(
      lanternPositions[1].x - lanternPositions[0].x,
      lanternPositions[1].y - lanternPositions[0].y,
    ) > 30,
    'Lantern must actually move before the camera starts',
  );
  const waveFrames = [animation.motionStartFrame + 5, animation.motionStartFrame + 20].map(
    (frame) => raw(frame, animation.waveBox),
  );
  let waveChangedRedPixels = 0;
  for (let i = 0; i < waveFrames[0].length; i += 3) {
    const red = (b: Buffer) =>
      Math.abs(b[i] - 237) < 20 && Math.abs(b[i + 1] - 28) < 20 && Math.abs(b[i + 2] - 36) < 20;
    if (red(waveFrames[0]) !== red(waveFrames[1])) waveChangedRedPixels++;
  }
  assert.ok(waveChangedRedPixels > 100, 'The red arm itself must move, not just an unrelated prop');
  const cameraFrames = [animation.cameraStartFrame + 1, 235];
  const landmarks = cameraFrames.map((frame) => {
    const bytes = raw(frame, [0, 0, 1080, 1500]);
    return {
      badge: centroid(bytes, 1080, [47, 128, 237], 20),
      bench: centroid(bytes, 1080, [112, 69, 45], 18),
      sun: centroid(bytes, 1080, [255, 241, 168], 14),
      lantern: centroid(bytes, 1080, [211, 54, 68], 20),
    };
  });
  const [a, b] = landmarks,
    scale = (b.bench.x - b.badge.x) / (a.bench.x - a.badge.x),
    shift = b.badge.x - scale * a.badge.x;
  const parallaxResidual = b.sun.x - (scale * a.sun.x + shift);
  assert.ok(
    Math.abs(parallaxResidual) > 5,
    'Far sky must move differently from foreground affine camera: ' + parallaxResidual,
  );
  assert.ok(animation.cameraKeyframes.length >= 2 && animation.lanternKeyframes.length >= 2);
  assert.ok(new Set(animation.parallaxLayers.map((layer: any) => layer.factor)).size >= 2);
  const document = await readVideoProject(
    directory,
    project.id,
    project.agents[0].outputPath + '/film.pistudio.json',
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
  assert.equal(document.timeline.tracks.filter((track) => track.type === 'audio').length, 1);
  assert.equal(document.timeline.tracks.filter((track) => track.type === 'subtitles').length, 1);
  for (const name of ['visual.mp4', 'film.mp4']) {
    const probe = JSON.parse(
      execFileSync(
        '/opt/homebrew/bin/ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(output, name)],
        { encoding: 'utf8' },
      ),
    );
    const v = probe.streams.find((stream: any) => stream.codec_type === 'video');
    assert.deepEqual(
      [v.width, v.height, v.avg_frame_rate, Number(v.nb_frames)],
      [1080, 1920, '30/1', 240],
    );
    assert.equal(
      probe.streams.some((stream: any) => stream.codec_type === 'audio'),
      name === 'film.mp4',
    );
    ffmpeg(['-i', join(output, name), '-f', 'null', '-']);
  }
  const files = await fingerprint(output);
  await host.launch(request);
  assert.equal(await exits.at(-1), 0);
  assert.equal(await readFile(session, 'utf8'), transcript);
  assert.deepEqual(await fingerprint(output), files);
  const filesToReview = Object.keys(files).filter(
    (path) =>
      !path.split('/').some((name) => ['.pistudio-library', '.qa-tmp', '.qa-home'].includes(name)),
  );
  const outputBytes = (
    await Promise.all(filesToReview.map((path) => stat(join(output, path))))
  ).reduce((sum, entry) => sum + entry.size, 0);
  assert.ok(
    outputBytes < 24 * 1024 ** 2 && filesToReview.length < 100,
    'Keep the actual deliverable small, without retained render frames',
  );
  const scopeAudit = (await readFile(toolScope.audit, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  if (!verifyOnly)
    assert.ok(
      scopeAudit.some((entry) => entry.action === 'sandboxed-bash'),
      'Native Pi must actually apply the assigned scope',
    );
  await mkdir(artifact, { recursive: true });
  await cp(output, artifact, {
    recursive: true,
    filter: (path) =>
      !path.split('/').some((name) => ['.pistudio-library', '.qa-tmp', '.qa-home'].includes(name)),
  });
  const proof = {
    checkedAt: new Date().toISOString(),
    version: '0.2.0-alpha.60',
    actualPi: pi.version,
    model: profile.model!.id,
    reasoning: profile.model!.reasoning,
    actualAgentBashRender: true,
    sha256: files['film.mp4'],
    projectOnlyClothingAndPose: true,
    libraryUnchanged: true,
    voiceDurationSeconds: voiceDuration,
    speechDrivenShotBoundary: animation.cameraStartFrame,
    actualEnvelopeMatchesSamples: true,
    mouthPixelCounts: { silent: silentMouth, voiced: voicedMouth, peakFrame },
    eyeWhitePixelCounts: eyePixels,
    pupilCenters: pupils,
    lanternPositions,
    waveChangedRedPixels,
    landmarks,
    foregroundAffineScale: scale,
    parallaxResidualPixels: parallaxResidual,
    qaScopePreflight: toolScope.preflight,
    qaScopeAppliedBashCalls: scopeAudit.filter((entry) => entry.action === 'sandboxed-bash').length,
    outputBytes,
    validatedVideoContract: true,
    completeFfmpegDecode: true,
    exactIdleResumeWithoutReplay: true,
    totalSessionUserMessages: messages.filter((message) => message.role === 'user').length,
    paidMediaApiCalls: 0,
    userStudioTouched: false,
    limits:
      'Concrete agent-authored scene, continuous local TTS with amplitude-driven mouth, not phoneme/word forced alignment. QA-only tool package is not bundled or applied to user agents. No generated code is loaded by Studio; native viewer/visual motion review checked separately before cleanup.',
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'passed', artifact, studio: root, ...proof }));
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
  console.log('Owned QA retained until native and visual review: ' + root);
}
