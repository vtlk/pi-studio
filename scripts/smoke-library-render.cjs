const { app, BrowserWindow, nativeImage } = require('electron');
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
  access,
  readdir,
} = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
app.on('window-all-closed', () => {});
let root, channel;
const deadline = setTimeout(() => {
  console.error('Library frame renderer timed out');
  app.exit(1);
}, 60000);
(async () => {
  root = await mkdtemp(join(tmpdir(), 'pistudio-library-render-'));
  const data = join(root, 'UserData');
  await mkdir(data);
  app.setPath('userData', data);
  const bundle = join(root, 'harness.cjs');
  const entries = [
    ['StudioService', 'src/main/storage/StudioStore.ts'],
    ['buildRunContext', 'src/main/pi/ContextBuilder.ts'],
    ['RunChannel', 'src/main/pi/RunChannel.ts'],
    ['libraryTool,libraryTools', 'src/main/library/tools.ts'],
    ['rasterizePreview', 'src/main/library/rasterizePreview.ts'],
    ['writeLibraryFixture', 'scripts/fixtures/library.mjs'],
    ['characterFixture', 'scripts/fixtures/character-rig.ts'],
  ];
  const entry = join(root, 'harness.ts');
  await writeFile(
    entry,
    entries
      .map(([names, path]) => `export {${names}} from ${JSON.stringify(resolve(path))};`)
      .join('\n'),
  );
  const { build } = await import('rolldown');
  await build({
    input: entry,
    platform: 'node',
    external: ['electron'],
    output: { file: bundle, format: 'cjs' },
  });
  const {
    StudioService,
    buildRunContext,
    RunChannel,
    libraryTool,
    libraryTools,
    rasterizePreview,
    writeLibraryFixture,
    characterFixture,
  } = require(bundle);
  await app.whenReady();
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio')),
    store = await service.load();
  const profiles = ['artist', 'other'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    plugins: [],
    mcps: ['pistudio-library'],
    model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'low', temperature: '' },
  }));
  await store.saveSection('agents', profiles);
  const project = (
    await store.command({ kind: 'create', name: 'Frame renderer QA', agents: profiles })
  ).projects[0];
  const projectRoot = await store.projects.directory(project.id);
  channel = new RunChannel();
  const leases = [];
  for (const profile of profiles) {
    const run = await buildRunContext(projectRoot, project, profile.id, profiles, []);
    const lease = await channel.add(
      run.record.runId,
      { record: run.record, instructions: '', resources: run.resources },
      async () => {},
      (name, args) => libraryTool(service, run, name, args, 'project', rasterizePreview),
      libraryTools,
    );
    leases.push({ run, lease });
  }
  const rpc = async (method, params, index = 0) => {
    const lease = leases[index].lease;
    const response = await fetch(lease.url + '/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + lease.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    if (result?.isError) throw Error(result.content[0].text);
    return method === 'tools/call' ? JSON.parse(result.content[0].text) : result;
  };
  const tool = (name, args, index = 0) => rpc('tools/call', { name, arguments: args }, index);
  assert.ok((await rpc('tools/list')).tools.some((t) => t.name === 'library_render_preview'));
  const prepared = await tool('library_prepare_asset', {
    kind: 'characters',
    title: 'Deterministic native frame',
  });
  await writeLibraryFixture(prepared);
  const fixture = characterFixture();
  await writeFile(join(prepared.stagingDirectory, 'art.svg'), fixture.svg);
  await writeFile(join(prepared.stagingDirectory, 'rig.json'), JSON.stringify(fixture.rig));
  await writeFile(
    join(prepared.stagingDirectory, 'asset.json'),
    JSON.stringify({
      ...prepared.manifest,
      files: { ...prepared.manifest.files, vector: 'art.svg', rig: 'rig.json' },
    }),
  );
  await rm(join(prepared.stagingDirectory, 'preview.png'));
  await writeFile(
    join(prepared.stagingDirectory, 'generated.js'),
    'throw new Error("GENERATED_CODE_MUST_NOT_RUN")',
  );
  const originals = await Promise.all(
    ['asset.json', 'reference.png', 'art.svg', 'rig.json'].map((p) =>
      readFile(join(prepared.stagingDirectory, p)),
    ),
  );
  const frame = (character) =>
    tool('library_render_preview', { token: prepared.token, width: 240, height: 360, character });
  const idle = await frame({ action: 'idle', emotion: 'neutral', time: 0 });
  const repeated = await frame({ action: 'idle', emotion: 'neutral', time: 0 });
  assert.deepEqual(
    await readFile(idle.path),
    await readFile(repeated.path),
    'Same time/pose produces identical PNG bytes',
  );
  const walk = await frame({ action: 'walk', emotion: 'smile', time: 0.2, headTilt: 7, gazeX: 1 });
  const blink = await frame({ action: 'idle', emotion: 'neutral', time: 3.53, blink: true });
  assert.notEqual(walk.sha256, idle.sha256);
  assert.notEqual(blink.sha256, idle.sha256);
  for (const result of [idle, walk, blink]) {
    const image = nativeImage.createFromBuffer(await readFile(result.path));
    assert.deepEqual(image.getSize(), { width: 240, height: 360 });
    assert.equal(image.toBitmap()[3], 0, 'Character letterbox/corner stays transparent');
    assert.ok(result.path.startsWith(leases[0].run.record.output + '/previews/'));
  }
  assert.deepEqual(
    await Promise.all(
      ['asset.json', 'reference.png', 'art.svg', 'rig.json'].map((p) =>
        readFile(join(prepared.stagingDirectory, p)),
      ),
    ),
    originals,
  );
  assert.equal((await store.library.list()).assets.length, 0);
  await assert.rejects(access(join(prepared.stagingDirectory, 'preview.png')));
  await assert.rejects(
    () => tool('library_render_preview', { token: prepared.token, width: 240, height: 360 }, 1),
    /другим агентом/,
  );
  await assert.rejects(
    () => tool('library_render_preview', { token: prepared.token, width: 4000 }),
    /числом/,
  );
  await copyFile(idle.path, join(prepared.stagingDirectory, 'preview.png'));
  assert.equal((await tool('library_validate_asset', { token: prepared.token })).validated, true);
  const published = await tool('library_publish_asset', { token: prepared.token });
  assert.equal(published.manifest.version, 1);
  assert.equal((await store.library.list()).assets.length, 1);
  await assert.rejects(() => frame({}), /опубликованного/);
  const location = await tool('library_prepare_asset', {
    kind: 'locations',
    title: 'Camera frame',
  });
  await writeLibraryFixture(location);
  await rm(join(location.stagingDirectory, 'preview.png'));
  const camera = async (zoom) =>
    tool('library_render_preview', {
      token: location.token,
      width: 320,
      height: 180,
      camera: { zoom, x: 20, y: -10 },
    });
  const wide = await camera(1),
    close = await camera(3);
  assert.notEqual(wide.sha256, close.sha256);
  const image = nativeImage.createFromBuffer(await readFile(wide.path));
  assert.deepEqual(image.getSize(), { width: 320, height: 180 });
  assert.equal(image.toBitmap()[3], 255);
  await writeFile(join(location.stagingDirectory, 'art.svg'), '<svg onload="alert(1)"/>');
  const before = (await readdir(join(leases[0].run.record.output, 'previews'))).length;
  await assert.rejects(() => camera(1), /SVG/);
  assert.equal((await readdir(join(leases[0].run.record.output, 'previews'))).length, before);
  await store.saveSection(
    'agents',
    profiles.map((p) => (p.id === 'artist' ? { ...p, mcps: [] } : p)),
  );
  await assert.rejects(() => camera(1), /не назначен/);
  assert.equal(
    BrowserWindow.getAllWindows().length,
    0,
    'Every offscreen frame window is destroyed',
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  for (const [name, result] of [
    ['idle', idle],
    ['walk', walk],
    ['blink', blink],
    ['location', wide],
    ['camera', close],
  ])
    await copyFile(result.path, resolve(`artifacts/library-render-${name}.png`));
  const proof = {
    passed: true,
    transport: 'production RunChannel MCP + scoped libraryTool + native Chromium rasterizer',
    deterministicPng: true,
    poseAndBlinkChangePixels: true,
    characterAlpha: true,
    locationCameraAndDimensions: true,
    missingPreviewSupported: true,
    explicitCopyValidatePublish: true,
    originalsUnchanged: true,
    wrongAgentAndRevokedGrantRefused: true,
    invalidDataRefusedBeforeRender: true,
    allRenderWindowsDestroyed: true,
    modelRequests: 0,
    generatedCodeExecuted: false,
  };
  await writeFile(
    resolve('artifacts/library-render-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
  clearTimeout(deadline);
  channel.close();
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  channel?.close();
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  if (root)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
