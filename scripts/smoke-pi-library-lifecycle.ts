import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { PreviewRenderer } from '../src/main/library/previewOptions.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { LaunchAgentRequest, LaunchAgentResult } from '../src/shared/runtime.ts';

// Real model + production native library tools/renderer. All assets and histories are disposable QA data.
const continuationIndex = process.argv.indexOf('--continue');
const continuation = continuationIndex >= 0;
const root = continuation
  ? await realpath(process.argv[continuationIndex + 1])
  : await mkdtemp(join(tmpdir(), 'pistudio-library-lifecycle-'));
assert.match(basename(root), /^pistudio-library-lifecycle-[A-Za-z0-9]+$/);
assert.equal(await realpath(dirname(root)), await realpath(tmpdir()));
const repair = process.argv.includes('--repair');
const previousArtifact = resolve('artifacts/library-lifecycle');
const previousProof = repair
  ? JSON.parse(await readFile(join(previousArtifact, 'proof.json'), 'utf8'))
  : undefined;
const currentVersion = repair ? previousProof.oneCardStableIdVersions.at(-1) + 1 : 2;
await mkdir(join(root, 'RendererData'), { recursive: true });
const electron = (await import('electron')).default as unknown as string;
const renderer = spawn(electron, ['scripts/library-preview-worker.cjs'], {
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  env: { ...process.env, PI_STUDIO_QA_RENDER_DIRECTORY: root, ELECTRON_RUN_AS_NODE: '' },
});
let rendererError = '';
renderer.stderr!.on('data', (data) => {
  rendererError += data.toString().slice(0, 2000);
});
const rendererExit = new Promise<number | null>((done) => renderer.once('exit', done));
const ready = new Promise<void>((done, reject) => {
  renderer.on('message', (message) => {
    if ((message as { ready?: boolean }).ready) done();
  });
  renderer.once('error', reject);
  renderer.once('exit', (code) =>
    reject(Error(`Renderer exited before ready: ${code} ${rendererError}`)),
  );
});
let nextFrame = 0;
const renderPending = new Map<
  number,
  { resolve(data: Buffer): void; reject(error: Error): void }
>();
renderer.on('message', (raw) => {
  const message = raw as { id: number; data?: string; error?: string };
  const pending = renderPending.get(message.id);
  if (!pending) return;
  renderPending.delete(message.id);
  if (message.error) pending.reject(Error(message.error));
  else pending.resolve(Buffer.from(message.data!, 'base64'));
});
let renderedFrames = 0;
const preview: PreviewRenderer = async (source, frame) => {
  renderedFrames++;
  const id = ++nextFrame;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      renderPending.delete(id);
      reject(Error('Native preview timed out'));
    }, 15000);
    renderPending.set(id, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    renderer.send({ id, source, frame });
  });
};
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const pi = await checkPi('');
assert.equal(pi.supported, true);
const artist: Agent = {
  id: 'qa-artist',
  name: 'QA Ruby artist',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: ['pistudio-library'],
  plugins: [],
  mainInstruction:
    'You are an isolated QA artist. Work only in your output and main-owned library preparation folders. Read library_get_contract before authoring data. Use native bash/read and assigned production library tools only. Never read application source, unrelated projects or credentials, change app code, use browser/computer/web tools, install dependencies, play audio or call paid media APIs. Make actual original artwork and a valid animated data rig, not placeholders or an executable preview. Do not ask for approval; fix validation errors and call complete_stage when the explicit request is finished.',
  model: {
    connectionId: 'qa',
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    reasoning: 'Низкий',
    temperature: '',
  },
};
await store.saveSection('connections', [
  {
    id: 'qa',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
await store.saveSection('agents', [artist]);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(directory: string): Promise<[string, string][]> {
  const result: [string, string][] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      for (const [name, hash] of await fingerprint(path))
        result.push([`${entry.name}/${name}`, hash]);
    else result.push([entry.name, digest(await readFile(path))]);
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
}
let v1: { id: string; directory: string; fingerprint: [string, string][] } | undefined;
const preserved = new Map<string, [string, string][]>();
if (repair) {
  const directory = join(store.folder, 'library/characters', previousProof.assetId, 'versions');
  if (!continuation) await cp(join(previousArtifact, 'versions'), directory, { recursive: true });
  for (let version = 1; version < currentVersion + (continuation ? 1 : 0); version++) {
    const path = join(directory, String(version));
    preserved.set(path, await fingerprint(path));
  }
  v1 = {
    id: previousProof.assetId,
    directory: join(directory, '1'),
    fingerprint: preserved.get(join(directory, '1'))!,
  };
}
const publish = store.library.publish.bind(store.library);
let publications = 0;
store.library.publish = async (output, token) => {
  publications++;
  const result = await publish(output, token);
  if (result.manifest.version === 1)
    v1 = {
      id: result.manifest.id,
      directory: result.directory,
      fingerprint: await fingerprint(result.directory),
    };
  if (result.manifest.version >= 2) {
    assert.ok(v1);
    assert.equal(result.manifest.id, v1.id);
    assert.deepEqual(await fingerprint(v1.directory), v1.fingerprint);
    for (const [path, hashes] of preserved) assert.deepEqual(await fingerprint(path), hashes);
  }
  return result;
};
function referencePng() {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      head = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([head, type, data, crc]);
  };
  const w = 256,
    h = 256,
    header = Buffer.alloc(13),
    rows = Buffer.alloc(h * (1 + w * 3));
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      rows.set(
        y >= 40 && y <= 215 && Math.abs(x - 128) < (y - 40) * 0.52
          ? [235, 25, 35]
          : [255, 255, 255],
        y * (1 + w * 3) + 1 + x * 3,
      );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const input = join(root, 'reference.png');
const image = referencePng();
await writeFile(input, image);
const references = new ReferenceFiles();
const selection = await references.select([input], store.folder);
const project = continuation
  ? store.bootstrap().projects[0]
  : (await store.command({ kind: 'create', name: 'QA Library lifecycle', agents: [artist] }))
      .projects[0];
assert.ok(project);
const children: Promise<number | null>[] = [];
const host = createStudioRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: resolve('bundled/pi-bridge/session.mjs'),
  catalog: resolve('bundled/pi-bridge/catalog.mjs'),
  piPath: () => pi.path,
  references,
  libraryPreview: preview,
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
let successful = false;
try {
  await ready;
  console.log(JSON.stringify({ phase: 'started', studio: root }));
  const transcriptBefore = continuation
    ? await readFile(
        join(await store.projects.directory(project.id), project.agents[0].session!.path),
        'utf8',
      )
    : undefined;
  if (continuation) {
    const internal = host as unknown as {
      open(request: LaunchAgentRequest, message: string): Promise<LaunchAgentResult>;
    };
    await internal.open(
      { projectId: project.id, agentId: artist.id, autoContinue: false },
      'One correction to your existing task in this exact dialogue: project-variant/character.svg still contains version-two-badge, so it came from v2 despite cast.json pinning v1. Read library_get_asset with explicit version:1, copy BOTH its vector and rig from the returned v1 directory into project-variant, and append only the purple project-only-badge (x=112,y=155,width=16,height=8,fill=#9158E5) to the FRONT/end of its body group. The local variant must contain project-only-badge and must NOT contain version-two-badge. Preserve every already-published version 1/2/3 byte-for-byte; do not prepare or publish a new asset version, do not edit app code. Preserve cast.json pin v1 with availableUpdate v3 and the successful blink/preview outputs. Check your corrected file, then complete_stage with observation.json, lifecycle.json, cast.json, project-variant/character.svg, project-variant/rig.json and blink-control.png. Do not just claim it is fixed.',
    );
  } else
    await host.launch({
      projectId: project.id,
      agentId: artist.id,
      autoContinue: false,
      attachments: selection.map((item) => item.id),
      firstMessage: repair
        ? `Repair an existing published QA mascot through the library MCP, without app-code edits, direct edits to published folders, duplicates, paid tools or backups. The asset ID is ${previousProof.assetId}; its latest version is ${currentVersion - 1}. Inspect the attached original PNG and write observation.json with English dominantShape/dominantColor from the visual reference. Read library_get_contract, library_find_assets and library_get_asset for explicit version 1 and the current asset. Preserve the exact v1/v2 data and create only version ${currentVersion} using library_prepare_asset existingId. The last author inserted data-part="version-two-badge" BEFORE the torso polygon, so the torso hides it: move this same small blue #2F80ED badge to the FRONT of the body group (append after the other body children), around x=112,y=125,width=16,height=8, where it remains clearly visible below the head. Preserve the existing design and all actions/emotions. Also inspect/fix the existing eyelid paths and blink maps so a closed blink covers each whole white and pupil with skin-colored filled lid paths, rather than just a thin line; follow the contract's independent left/right channels. Use trusted library_render_preview at neutral/idle t=3.54 (blink false) and t=3.54 (blink true); read the PNGs to inspect both. Keep the open-eye PNG as the declared preview; save the blink PNG to output/blink-control.png. Validate and publish under the SAME asset ID. Read old pinned v1 and current v${currentVersion} again. In this project's output copy v1 SVG/rig to project-variant/, append a visible small purple data-part="project-only-badge" fill="#9158E5" at x=112,y=155,width=16,height=8 in FRONT of the body, never edit the original. Write lifecycle.json with assetId, initialVersion:1, latestVersion:${currentVersion}, pinnedVersion:1 and cast.json with libraryReference:{kind:"characters",id:<same id>,version:1}, availableUpdate:{version:${currentVersion}}, projectVariant:{vector:"project-variant/character.svg",rig:"project-variant/rig.json"}. Keep pin v1 and only propose the upgrade. Complete with observation.json, lifecycle.json, cast.json, project-variant/character.svg, project-variant/rig.json and blink-control.png. Do not copy instructions or executable preview code into assets.`
        : `Complete this actual library lifecycle in this one task, using only your assigned native bash/read and library MCP tools. First inspect the attached PNG visually and write observation.json with English dominantShape and dominantColor; do not infer content from its generic filename.
1. Call library_get_contract. Create an original friendly humanoid mascot named "QA Руби", retaining the reference's dominant geometric silhouette/color as the torso and adding expressive eyes/head, arms and legs. Prepare a NEW characters asset, preserve the returned identity fields, and copy the exact attached PNG as reference.png. Write original layered static SVG with correct distinct data-part roles, and a complete pistudio-character-1 rig.json satisfying ALL six actions/eight emotions/gaze/blink/headTilt requirements. Use your own geometry/pivots, not app/fixture code. Use no SVG styles/scripts or executable preview code. Add files.vector and files.rig to asset.json. Call library_render_preview for idle/neutral at time 0, width/height 512, copy its trusted PNG to the declared preview path; validate and publish version 1. Save its returned stable asset ID.
2. Read version 1 with library_get_asset. Copy its SVG and rig to output/project-variant/, then add a small purple badge with data-part="project-only-badge" and fill="#9158E5" ONLY to that project copy. Never edit the published library files directly.
3. Read the same asset, call library_prepare_asset with existingId to modify it. Preserve its design/rig/reference. In the new staging SVG add a visible small blue badge, data-part="version-two-badge", fill="#2F80ED", in FRONT of the torso by appending it after the body group's other children. This marker must not exist in version 1 or the project variant. Use library_render_preview for wave/smile time 0.4, copy chosen PNG, validate and publish version 2 under the SAME ID. No duplicate/new asset card.
4. Read library_get_asset both with version:1 and without version; verify old v1 and current v2 are both available. Call library_find_assets and record one current card. Write lifecycle.json with assetId, initialVersion:1, latestVersion:2, pinnedVersion:1. Write cast.json with libraryReference:{kind:"characters",id:<same id>,version:1}, availableUpdate:{version:2}, and projectVariant:{vector:"project-variant/character.svg",rig:"project-variant/rig.json"}. Do not automatically change that project pin to v2. Keep outputs small. Call complete_stage with observation.json, lifecycle.json, cast.json, project-variant/character.svg and project-variant/rig.json after successful publication. Do not copy instructions, user prompts, executable app code or backups into library assets.`,
    });
  assert.equal(await children.at(-1), 0);
  let finished = await store.projects.read(project.id);
  for (let i = 0; i < 100 && finished.agents[0].runStatus !== 'ready'; i++) {
    await new Promise((done) => setTimeout(done, 100));
    finished = await store.projects.read(project.id);
  }
  assert.equal(finished.agents[0].runStatus, 'ready');
  const directory = await store.projects.directory(project.id),
    output = join(directory, finished.agents[0].outputPath);
  const observation = JSON.parse(await readFile(join(output, 'observation.json'), 'utf8'));
  assert.match(observation.dominantShape.toLowerCase(), /triangle/);
  assert.match(observation.dominantColor.toLowerCase(), /red/);
  const report = JSON.parse(await readFile(join(output, 'lifecycle.json'), 'utf8'));
  assert.deepEqual(
    [report.initialVersion, report.latestVersion, report.pinnedVersion],
    [1, currentVersion, 1],
  );
  assert.equal(report.assetId, v1?.id);
  const first = await store.library.get('characters', report.assetId, 1),
    latest = await store.library.get('characters', report.assetId);
  assert.equal(latest.manifest.version, currentVersion);
  assert.equal(latest.asset.library.animated, true);
  assert.equal((await store.library.list()).assets.length, 1);
  assert.deepEqual(await fingerprint(first.directory), v1!.fingerprint);
  assert.deepEqual(await readFile(join(first.directory, first.manifest.files.reference)), image);
  const firstSvg = await readFile(join(first.directory, first.manifest.files.vector!), 'utf8'),
    latestSvg = await readFile(join(latest.directory, latest.manifest.files.vector!), 'utf8');
  const variant = await readFile(join(output, 'project-variant/character.svg'), 'utf8');
  assert.equal(firstSvg.includes('version-two-badge'), false);
  assert.ok(latestSvg.includes('version-two-badge'));
  assert.ok(variant.includes('project-only-badge'));
  assert.equal(variant.includes('version-two-badge'), false);
  assert.equal(firstSvg.includes('project-only-badge'), false);
  const cast = JSON.parse(await readFile(join(output, 'cast.json'), 'utf8'));
  assert.deepEqual(cast.libraryReference, { kind: 'characters', id: report.assetId, version: 1 });
  assert.equal(cast.availableUpdate.version, currentVersion);
  const transcriptPath = join(directory, finished.agents[0].session!.path),
    transcript = await readFile(transcriptPath, 'utf8');
  if (continuation) {
    assert.equal(finished.agents[0].session!.path, project.agents[0].session!.path);
    assert.ok(transcript.startsWith(transcriptBefore!));
    const users = (text: string) =>
      text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.message?.role === 'user').length;
    assert.equal(users(transcript), users(transcriptBefore!) + 1);
    assert.equal(publications, 0);
    for (const [path, hashes] of preserved) assert.deepEqual(await fingerprint(path), hashes);
  }
  const messages = transcript
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.message);
  for (const name of [
    'library_get_contract',
    'library_prepare_asset',
    'library_render_preview',
    'library_validate_asset',
    'library_publish_asset',
    'library_get_asset',
    'library_find_assets',
  ])
    assert.ok(
      messages.some(
        (message) =>
          message.role === 'toolResult' &&
          message.toolName === `mcp__pi_studio__${name}` &&
          !message.isError,
      ),
      name,
    );
  assert.ok(!messages.some((message) => /configure_agent/.test(message.toolName ?? '')));
  const successfulPreviewCalls = messages.filter(
    (message) =>
      message.role === 'toolResult' &&
      message.toolName === 'mcp__pi_studio__library_render_preview' &&
      !message.isError,
  ).length;
  assert.ok(successfulPreviewCalls >= 2);
  await host.launch({ projectId: project.id, agentId: artist.id, autoContinue: false });
  assert.equal(await children.at(-1), 0);
  assert.equal(await readFile(transcriptPath, 'utf8'), transcript);
  const artifact = resolve('artifacts/library-lifecycle');
  await rm(artifact, { recursive: true, force: true });
  await mkdir(join(artifact, 'versions'), { recursive: true });
  for (let version = 1; version <= currentVersion; version++) {
    const asset = await store.library.get('characters', report.assetId, version);
    await cp(asset.directory, join(artifact, 'versions', String(version)), { recursive: true });
  }
  for (const name of ['observation.json', 'lifecycle.json', 'cast.json', 'project-variant'])
    await cp(join(output, name), join(artifact, name), { recursive: true });
  if (repair) await cp(join(output, 'blink-control.png'), join(artifact, 'model-blink-sample.png'));
  await writeFile(
    join(artifact, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: JSON.parse(await readFile('package.json', 'utf8')).version,
        actualPi: pi.version,
        model: artist.model!.id,
        assetId: report.assetId,
        realImageContentRecognized: true,
        originalLayeredSvgAndRig: true,
        productionNativePreviewFrames: successfulPreviewCalls,
        ...(continuation
          ? {
              correctedLocalVariantInExactExistingDialogue: true,
              oneAdditionalUserMessage: true,
              noRepublishDuringCorrection: true,
            }
          : {}),
        oneCardStableIdVersions: Array.from({ length: currentVersion }, (_, index) => index + 1),
        pinnedV1Unchanged: true,
        localProjectVariantDistinct: true,
        currentVersionAvailable: currentVersion,
        ...(repair
          ? {
              previousCreationCheck: previousProof,
              repairOfExistingAssetInNewProject: true,
              earlierPublishedVersionsUnchanged: true,
            }
          : {}),
        explicitUpgradeProposalInCastFile: true,
        exactIdleResumeWithoutReplay: true,
        paidMediaApiCalls: 0,
        limits:
          'Isolated production RunHost/native library MCP and trusted Electron preview worker. No administrative/Browser/Computer tools supplied to this QA model; no user studio or OS permissions changed. Native library UI controls are a separate check.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ phase: 'passed', artifact, assetId: report.assetId, renderedFrames }),
  );
  successful = true;
} finally {
  await host.drain();
  host.close();
  await Promise.allSettled(children);
  if (renderer.connected) renderer.send({ close: true });
  await rendererExit;
  if (successful) await rm(root, { recursive: true, force: true });
  else console.log('Disposable QA studio retained for inspection: ' + root);
}
