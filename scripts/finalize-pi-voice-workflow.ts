import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, realpath, rm, cp } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { readVideoProject } from '../src/main/video/readVideoProject.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Continue the exact retained, disposable QA dialogue, rather than rerun expensive synthesis
// when a late media assertion finds an issue. This is not an application IPC/API operation.
const root = process.argv[2];
assert.equal(
  typeof root,
  'string',
  'Pass the retained disposable pistudio-voice-workflow directory.',
);
assert.match(basename(root), /^pistudio-voice-workflow-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load(),
  project = store.bootstrap().projects[0];
const directory = await store.projects.directory(project.id);
const agent = project.agents[0],
  output = join(directory, agent.outputPath);
const session = join(directory, agent.session!.path);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function fingerprints(path: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const file = join(path, entry.name);
    if (entry.isDirectory())
      for (const [name, value] of Object.entries(await fingerprints(file)))
        files[join(entry.name, name)] = value;
    else files[entry.name] = hash(await readFile(file));
  }
  return files;
}
const before = await fingerprints(output),
  beforeTranscript = await readFile(session, 'utf8');
const pi = await checkPi('');
const children: Promise<number | null>[] = [];
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
    children.push(
      new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      }),
    );
  },
});
let passed = false;
try {
  const internal = host as unknown as {
    open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
  };
  await internal.open(
    { projectId: project.id, agentId: agent.profile.id, autoContinue: false },
    'One final targeted correction in this exact dialogue: the actual ffprobe shows animatic.mp4 has NO audio stream. Preserve every existing production.json, takes, word/line WAV, four stems, visual.mp4, film.mp4, scene/sound/dependency/shot metadata, timeline and manifest byte-for-byte. Change ONLY animatic.mp4 by muxing its existing held-image video with stems/speech.wav as AAC audio, exactly 8s/240 frames; use video stream copy so shot images remain identical. Write output/finalize_animatic.py containing this minimal operation for reproducibility; do not rerun the original generation script or synthesize voices again. Probe/decode the corrected actual animatic, confirm it has audio and speech with pauses. Do not play audio, inspect other projects, change app code or create backups. Validate the unchanged main video project and complete_stage with animatic.mp4 and finalize_animatic.py.',
  );
  assert.equal(await children.at(-1), 0);
  const after = await fingerprints(output);
  for (const [name, digest] of Object.entries(before))
    if (name !== 'animatic.mp4')
      assert.equal(after[name], digest, name + ' must remain byte-identical');
  assert.notEqual(after['animatic.mp4'], before['animatic.mp4']);
  assert.ok(after['finalize_animatic.py']);
  const updated = await store.projects.read(project.id);
  assert.equal(updated.agents[0].runStatus, 'ready');
  assert.equal(updated.agents[0].session!.path, agent.session!.path);
  const text = await readFile(session, 'utf8');
  const users = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .filter((entry) => entry.type === 'message' && entry.message?.role === 'user').length;
  assert.equal(users(text), users(beforeTranscript) + 1);
  const document = await readVideoProject(
    directory,
    project.id,
    `${agent.outputPath}/film.pistudio.json`,
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
  const pcm = (name: string, channels = 1) =>
    execFileSync(
      '/opt/homebrew/bin/ffmpeg',
      [
        '-v',
        'error',
        '-i',
        join(output, name),
        '-ar',
        '24000',
        '-ac',
        String(channels),
        '-f',
        's16le',
        '-',
      ],
      { maxBuffer: 8 * 1024 ** 2 },
    );
  const plan = JSON.parse(await readFile(join(output, 'production.json'), 'utf8'));
  assert.equal(plan.dialogues.length, 3);
  for (const line of plan.dialogues) {
    const samples = pcm(line.file);
    assert.ok(line.timelineStart + line.duration <= 8);
    assert.ok(Math.abs(line.duration - samples.length / 48000) < 0.001);
    for (const word of line.words) {
      const bytes = pcm(word.file),
        offset = Math.round(word.start * 24000) * 2;
      assert.ok(Math.abs(word.end - word.start - bytes.length / 48000) < 0.001);
      assert.deepEqual(samples.subarray(offset, offset + bytes.length), bytes);
    }
  }
  const stemMetrics = [];
  for (const name of ['speech', 'ambience', 'effects', 'music']) {
    const bytes = pcm('stems/' + name + '.wav', 2);
    assert.equal(bytes.length, 8 * 24000 * 4);
    let peak = 0,
      sum = 0;
    for (let i = 0; i < bytes.length; i += 2) {
      const value = bytes.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }
    const rms = Math.sqrt(sum / (bytes.length / 2));
    assert.ok(peak > 0.001 && peak < 0.999 && rms > 0.0001);
    stemMetrics.push({ name, peak, rms, sha256: hash(bytes) });
  }
  assert.equal(new Set(stemMetrics.map((item) => item.sha256)).size, 4);
  for (const name of ['animatic.mp4', 'film.mp4']) {
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
    execFileSync(
      '/opt/homebrew/bin/ffmpeg',
      ['-v', 'error', '-i', join(output, name), '-f', 'null', '-'],
      { timeout: 20000, stdio: 'pipe' },
    );
  }
  const frames = [30, 60, 150, 180].map((frame) =>
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
    ]),
  );
  const distance = (a: Buffer, b: Buffer) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
  assert.ok(distance(frames[0], frames[1]) < 0.5 && distance(frames[2], frames[3]) < 0.5);
  assert.ok(distance(frames[0], frames[2]) > 2);
  await host.launch({ projectId: project.id, agentId: agent.profile.id, autoContinue: false });
  assert.equal(await children.at(-1), 0);
  assert.equal(await readFile(session, 'utf8'), text);
  assert.deepEqual(await fingerprints(output), after);
  const artifact = resolve('artifacts/voice-workflow');
  await rm(artifact, { recursive: true, force: true });
  await cp(output, artifact, { recursive: true, filter: (path) => path !== join(output, 'input') });
  await writeFile(
    join(artifact, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: '0.2.0-alpha.60',
        actualPi: pi.version,
        model: 'gpt-5.6-luna',
        actualAgentBashRender: true,
        sha256: after['film.mp4'],
        paidMediaApiCalls: 0,
        desktopAudioPlayback: false,
        threeAssignedSpeakers: true,
        actualSegmentedWordSampleAlignment: true,
        fourDistinctFullLengthStems: stemMetrics,
        completeFfmpegDecode: true,
        twoDistinctStaticAnimaticShotsWithAudio: true,
        animaticOnlyRepairInExactDialogue: true,
        allOtherOutputsByteIdenticalAcrossFinalRepair: true,
        oneAdditionalUserMessageForFinalRepair: true,
        exactIdleResumeWithoutReplay: true,
        validatedViewerWithFourAudioAndCaptionTracks: true,
        priorRunEvidence: {
          log: 'preceding-run.log',
          source: 'scripts/smoke-pi-voice-workflow.ts',
          reached:
            'missing animatic audio assertion after sample/take/unchanged-output/split-merge/dependency/stem checks passed',
        },
        limits:
          'Actual macOS segmented word synthesis, not continuous-speech forced alignment. Earlier full-run comparisons and this targeted repair/check are distinct evidence. Agent-owned domain logs are not automatic Studio production screens. Input art is prior QA output; no user studio or OS permissions changed.',
      },
      null,
      2,
    ) + '\n',
  );
  await cp('/tmp/pistudio-voice60-final.log', join(artifact, 'preceding-run.log'));
  console.log(JSON.stringify({ phase: 'passed', artifact, stemMetrics }));
  passed = true;
} finally {
  host.close();
  await Promise.allSettled(children);
  if (passed) await rm(root, { recursive: true, force: true });
  else console.log('Disposable QA retained: ' + root);
}
