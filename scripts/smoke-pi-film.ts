import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, mkdir, cp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { readVideoProject } from '../src/main/video/readVideoProject.ts';
import type { Agent } from '../src/shared/studio.ts';

// Opt-in integration: actual selected Pi agents create all artwork, sound and video through bash.
// No Images API/paid media service, fixture movie, preinstalled roles or user-studio modifications.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-film-'));
const deadline = Date.now() + 15 * 60_000;
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
assert.deepEqual(store.bootstrap().sections.agents, []);
assert.deepEqual(store.bootstrap().sections.connections, []);
assert.deepEqual(store.bootstrap().sections.resources, []);
assert.equal(store.bootstrap().projects.length, 0);
const common =
  'You are running an isolated end-to-end Pi Studio QA project. Create actual creative deliverables, never markers/placeholders. Work only in your output; read previous agent outputs via project-scoped tools. Do not inspect credentials, unrelated projects or application source, install dependencies or call any paid image/media API. Do not ask for approval; execute the explicit test task. Use only the configured model and assigned production MCP/native bash. End with complete_stage listing your final deliverables. If something truly prevents work report_blocked and describe it, never claim success.';
const role = (id: string, name: string, instruction: string): Agent => ({
  id,
  name,
  enabled: true,
  skills: [],
  mcps: [],
  plugins: [],
  instructions: [],
  mainInstruction: common + '\n' + instruction,
  model: {
    connectionId: 'subscription',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
});
const agents = [
  role(
    'story',
    'Сценарий',
    'Write story.md and shots.json for an original 8-second two-shot gentle 2D cartoon: a girl notices a wilted flower, waters it, the flower opens and she smiles. Russian narration must be very short (e.g. two phrases fitting 8 seconds), with uppercase Russian subtitles. Define exact 1080x1920, 30 fps, 240 frames, two 120-frame shots and clear visible character/flower motions, palette and narration timing. This is a real short film, not a fixture protocol report.',
  ),
  role(
    'art',
    'Рисунки',
    'Read the actual scenario and shots.json from the previous agent using project tools. Create original polished flat cartoon artwork as self-contained static SVG assets for the character, background and flower, with identified logical parts and friendly expressive face. Use 1080x1920 composition coordinates, coherent pastel palette and visible dark outlines. No scripts, SMIL or external references inside SVG. Create art.json listing asset names, useful part IDs/pivots and intended movements matching shots.json. Use Python CairoSVG/Pillow (already installed) to save a storyboard.png with both shot previews. The final animator will read these exact assets; do not substitute unrelated drawings or merely write instructions.',
  ),
  role(
    'film',
    'Мультфильм',
    'Read the real scenario, shots.json and art.json and source SVGs from earlier agents through project tools. Copy the needed actual art into your output/assets, then animate these assets into a finished 8-second 1080x1920 30fps cartoon with two shots, clear girl/watering/flower opening motions and an expressive face. You may write render.py using installed Python Pillow/CairoSVG, and stream frames to /opt/homebrew/bin/ffmpeg to avoid retaining hundreds of frames. Use /usr/bin/say -v Milena for the short Russian narration (no download), mix a quiet locally synthesized tone/music into a PCM WAV exactly 8 seconds long, and render H.264 yuv420p MP4 with AAC audio and readable uppercase Russian subtitles. All source files and finished film.mp4 must be in your own output. Keep total final outputs under 32 MiB; delete only your own intermediate frame files if used. Call get_video_contract, then write compatible timeline.json and film.pistudio.json (scope film, editor remotion-player) for the bundled read-only viewer. A visual track referencing your finished film.mp4 with embedded audio/subtitles is sufficient; all asset paths are relative and inside your output. Use validate_video_project and fix any errors before complete_stage. Check the actual MP4 with ffprobe; do not fake a video, change dimensions/fps/duration or just supply an executable viewer.',
  ),
];
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
await store.saveSection('agents', agents);
const project = (await store.command({ kind: 'create', name: 'Капля заботы — проверка', agents }))
  .projects[0];
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
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
let successful = false;
try {
  console.log(
    JSON.stringify({ phase: 'started', studio: root, agents: agents.map((agent) => agent.name) }),
  );
  await host.launch({
    projectId: project.id,
    agentId: agents[0].id,
    autoContinue: true,
    firstMessage:
      'Создай законченный восьмисекундный вертикальный мультфильм «Капля заботы»: девочка поливает увядший цветок, он распускается и она улыбается. Два кадра-сцены, короткий русский голос и ЗАГЛАВНЫЕ субтитры, 1080×1920, 30 fps. Все нужные творческие решения прими самостоятельно; платных сервисов/установок не используй. Следующие агенты продолжат по цепочке.',
  });
  let previous = '';
  for (;;) {
    const current = await store.projects.read(project.id);
    const states = current.agents.map((agent) => ({
      name: agent.profile.name,
      status: agent.runStatus ?? 'not_started',
    }));
    const signature = JSON.stringify(states);
    if (signature !== previous) {
      console.log(JSON.stringify({ phase: 'agents', states }));
      previous = signature;
    }
    if (current.agents.every((agent) => agent.runStatus === 'ready')) break;
    if (
      current.agents.some((agent) =>
        ['error', 'waiting', 'stopped'].includes(agent.runStatus ?? ''),
      )
    )
      throw new Error(
        'A real film stage paused or failed; inspect the isolated QA studio: ' + root,
      );
    if (Date.now() > deadline) throw new Error('Real film generation exceeded 15 minutes: ' + root);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await Promise.all([...children]);
  const finished = await store.projects.read(project.id),
    directory = await store.projects.directory(project.id);
  const output = join(directory, finished.agents[2].outputPath);
  const document = await readVideoProject(
    directory,
    project.id,
    `${finished.agents[2].outputPath}/film.pistudio.json`,
  );
  assert.equal(document.timeline.width, 1080);
  assert.equal(document.timeline.height, 1920);
  assert.equal(document.timeline.fps, 30);
  assert.equal(document.timeline.durationInFrames, 240);
  const probe = JSON.parse(
    execFileSync(
      '/opt/homebrew/bin/ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(output, 'film.mp4')],
      { encoding: 'utf8' },
    ),
  );
  const video = probe.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === 'video',
  );
  const audio = probe.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === 'audio',
  );
  assert.equal(video?.codec_name, 'h264');
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.avg_frame_rate, '30/1');
  assert.equal(Number(video.nb_frames), 240);
  assert.equal(audio?.codec_name, 'aac');
  assert.ok(Math.abs(Number(probe.format.duration) - 8) < 0.15);
  const frameHashes = execFileSync(
    '/opt/homebrew/bin/ffmpeg',
    [
      '-v',
      'error',
      '-i',
      join(output, 'film.mp4'),
      '-vf',
      'fps=2,scale=90:160',
      '-f',
      'framemd5',
      '-',
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((line) => /^0,/.test(line))
    .map((line) => line.split(',').at(-1)?.trim());
  assert.ok(
    new Set(frameHashes).size >= 8,
    'The film must contain actual motion, not a static poster',
  );
  let total = 0,
    count = 0;
  const inspect = async (path: string) => {
    for (const item of await readdir(path, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink());
      const file = join(path, item.name);
      if (item.isDirectory()) await inspect(file);
      else {
        total += (await stat(file)).size;
        count++;
      }
    }
  };
  await inspect(output);
  assert.ok(total < 32 * 1024 ** 2 && count < 100, 'QA output must stay small');
  const artifact = resolve('artifacts/film-workflow');
  await rm(artifact, { recursive: true, force: true });
  await mkdir(artifact, { recursive: true });
  await cp(output, artifact, { recursive: true });
  execFileSync('/opt/homebrew/bin/ffmpeg', [
    '-v',
    'error',
    '-i',
    join(artifact, 'film.mp4'),
    '-vf',
    'fps=1/2,scale=270:480,tile=4x1',
    '-frames:v',
    '1',
    '-y',
    join(artifact, 'contact-sheet.png'),
  ]);
  const transcriptMessages = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((item) => item.type === 'message');
  const transcripts = await Promise.all(
    finished.agents.map((agent) => readFile(join(directory, agent.session!.path), 'utf8')),
  );
  assert.ok(
    transcripts.every((text) =>
      transcriptMessages(text).some((entry) => entry.message?.role === 'assistant'),
    ),
  );
  const hash = createHash('sha256')
    .update(await readFile(join(output, 'film.mp4')))
    .digest('hex');
  await host.launch({ projectId: project.id, agentId: agents[2].id, autoContinue: false });
  await children[3];
  assert.equal(
    (await store.projects.read(project.id)).agents[2].session?.path,
    finished.agents[2].session?.path,
  );
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(output, 'film.mp4')))
      .digest('hex'),
    hash,
  );
  assert.equal(
    transcriptMessages(await readFile(join(directory, finished.agents[2].session!.path), 'utf8'))
      .length,
    transcriptMessages(transcripts[2]).length,
  );
  const proof = {
    actualPi: pi.version,
    model: agents[0].model!.id,
    stages: finished.agents.map((agent) => ({ name: agent.profile.name, status: agent.runStatus })),
    actualAgentBashRender: true,
    paidMediaApiCalls: 0,
    width: video.width,
    height: video.height,
    fps: 30,
    frames: 240,
    audio: audio.codec_name,
    sha256: hash,
    revision: document.revision,
    exactIdleResume: true,
    outputBytes: total,
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'passed', artifact, ...proof }));
  successful = true;
} finally {
  host.close();
  await Promise.allSettled(children);
  if (successful) await rm(root, { recursive: true, force: true });
  else console.log('Disposable failed QA studio retained for inspection: ' + root);
}
