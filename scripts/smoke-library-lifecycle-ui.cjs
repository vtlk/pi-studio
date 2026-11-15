const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, renameSync } = require('node:fs');
const { rm, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const artifact = resolve('artifacts/library-lifecycle');
let root;
const timeout = setTimeout(() => fail(Error('Generated library UI timed out')), 45000);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function cleanup() {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  const proof = JSON.parse(readFileSync(join(artifact, 'proof.json'), 'utf8'));
  const currentVersion = proof.oneCardStableIdVersions.at(-1);
  const currentDirectory = join(artifact, 'versions', String(currentVersion));
  const manifest = JSON.parse(readFileSync(join(currentDirectory, 'asset.json'), 'utf8'));
  const rig = JSON.parse(readFileSync(join(currentDirectory, manifest.files.rig), 'utf8'));
  assert.equal(manifest.id, proof.assetId);
  assert.equal(manifest.version, currentVersion);
  const bitmap = nativeImage
    .createFromPath(join(currentDirectory, manifest.files.preview))
    .toBitmap();
  let bluePixels = 0;
  for (let i = 0; i < bitmap.length; i += 4)
    if (
      bitmap[i] > 180 &&
      bitmap[i + 1] > 90 &&
      bitmap[i + 1] < 180 &&
      bitmap[i + 2] < 100 &&
      bitmap[i + 3] > 200
    )
      bluePixels++;
  assert.ok(bluePixels > 100, 'Published native PNG must visibly contain the requested blue badge');
  root = mkdtempSync(join(tmpdir(), 'pistudio-library-ui-live-'));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  for (const path of [studio, userData, join(studio, '.pistudio')]) mkdirSync(path);
  const versions = join(studio, 'library/characters', proof.assetId, 'versions');
  mkdirSync(versions, { recursive: true });
  for (const version of proof.oneCardStableIdVersions.filter((value) => value < currentVersion))
    cpSync(join(artifact, 'versions', String(version)), join(versions, String(version)), {
      recursive: true,
    });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: {} }),
  );
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action);
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.setAudioMuted(true);
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await sleep(35);
    }
    throw Error('Timed out: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const selector = (attribute, part) => `[${attribute}=${JSON.stringify(part)}]`;
  const transform = (part) =>
    js(
      `document.querySelector(${JSON.stringify(selector('data-rig-transform', part))}).getAttribute('transform')`,
    );
  const path = (part) =>
    js(`document.querySelector(${JSON.stringify(selector('data-part', part))}).getAttribute('d')`);
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await click('Библиотека');
  await until(`!!document.querySelector('[data-character-engine="pistudio-character-1"]')`);
  await js(`window.__qaOldSvg=document.querySelector('[data-character-engine="pistudio-character-1"]')`);
  // Atomic publication of actual model-produced data while the UI is open.
  // Let the production poll/index/loader discover it, without an explicit refresh action.
  const incoming = join(versions, '.incoming');
  cpSync(currentDirectory, incoming, { recursive: true });
  renameSync(incoming, join(versions, String(currentVersion)));
  await until(`!window.__qaOldSvg.isConnected && !!document.querySelector('[data-character-engine="pistudio-character-1"]')`);
  const detached = await js('window.__qaOldSvg.outerHTML');
  await sleep(250);
  assert.equal(await js('window.__qaOldSvg.outerHTML'), detached, 'Replaced rig clock is disposed');
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  assert.equal(await js(`document.querySelector('.library-stage h2').textContent`), manifest.title);
  assert.equal(
    await js(`document.querySelectorAll('[aria-label="Действие"] button:not(:disabled)').length`),
    6,
  );
  assert.equal(
    await js(`document.querySelectorAll('[aria-label="Эмоция"] button:not(:disabled)').length`),
    8,
  );
  assert.equal(await js(`document.querySelectorAll('script[src*="library-runtime"]').length`), 0);
  const neutral = await path(rig.parts.mouth);
  await click('Улыбка');
  await until(
    `document.querySelector(${JSON.stringify(selector('data-part', rig.parts.mouth))}).getAttribute('d')!==${JSON.stringify(neutral)}`,
  );
  await click('Махать');
  await sleep(200);
  const arm = await transform(rig.parts.rightArm);
  const otherArm = await transform(rig.parts.leftArm);
  await sleep(300);
  assert.ok(
    (await transform(rig.parts.rightArm)) !== arm ||
      (await transform(rig.parts.leftArm)) !== otherArm,
    'Generated wave must move an actual arm',
  );
  const pupil = () =>
    js(
      `document.querySelector(${JSON.stringify(selector('data-rig-transform', rig.parts.leftPupil))}).transform.baseVal.getItem(0).matrix.e`,
    );
  await js(`document.querySelector('[aria-label="Влево"]').click()`);
  await sleep(450);
  const left = await pupil();
  await js(`document.querySelector('[aria-label="Вправо"]').click()`);
  await sleep(450);
  const right = await pupil();
  assert.ok(right > left + 0.5, 'Manual gaze must move the generated pupil');
  await click('Моргнуть');
  await sleep(130);
  const closedLid = await path(rig.parts.leftLid);
  await sleep(350);
  assert.notEqual(await path(rig.parts.leftLid), closedLid);
  const head = await transform(rig.parts.head);
  await js(
    `(()=>{const input=document.querySelector('[aria-label="Наклон головы"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'7');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await sleep(350);
  assert.notEqual(await transform(rig.parts.head), head);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await sleep(60);
  const hidden = await transform(rig.parts.rightArm);
  await sleep(250);
  assert.equal(await transform(rig.parts.rightArm), hidden);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await sleep(100);
  await writeFile(join(artifact, 'studio-character.png'), (await window.capturePage()).toPNG());
  assert.equal(window.isVisible(), false);
  const entry = join(root, 'frame-entry.ts'),
    bundle = join(root, 'frame.cjs');
  await writeFile(
    entry,
    [
      ['parseCharacterSvg', 'src/shared/characterSvg.ts'],
      ['parseCharacterRig', 'src/shared/parseCharacterRig.ts'],
      ['characterSvgFrame', 'src/shared/characterSvgFrame.ts'],
      ['previewOptions', 'src/main/library/previewOptions.ts'],
      ['rasterizePreview', 'src/main/library/rasterizePreview.ts'],
    ]
      .map(([name, path]) => `export {${name}} from ${JSON.stringify(resolve(path))};`)
      .join('\n'),
  );
  const { build } = await import('rolldown');
  await build({
    input: entry,
    platform: 'node',
    external: ['electron'],
    output: { file: bundle, format: 'cjs' },
  });
  const helpers = require(bundle),
    parsed = helpers.parseCharacterSvg(
      readFileSync(join(currentDirectory, manifest.files.vector), 'utf8'),
    );
  const source = { svg: parsed.svg, rig: helpers.parseCharacterRig(rig, parsed.parts) };
  const frames = [];
  for (const blink of [false, true]) {
    const opts = helpers.previewOptions({
      width: 512,
      height: 512,
      character: { action: 'idle', emotion: 'neutral', time: 3.54, blink },
    });
    const svg = helpers.characterSvgFrame(source, opts.character, opts.time);
    const png = await helpers.rasterizePreview(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      { ...opts, transparent: true },
    );
    const pixels = nativeImage.createFromBuffer(png).toBitmap();
    let white = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240 && pixels[i + 3] > 240)
        white++;
    frames.push(white);
    await writeFile(
      join(artifact, blink ? 'blink-closed-control.png' : 'blink-open-control.png'),
      png,
    );
  }
  assert.ok(frames[0] > 500, 'The QA drawing has white eyes in the open control');
  assert.ok(frames[1] < frames[0] * 0.05, 'The authored closed lids must cover the white eyes');
  proof.nativeUi = {
    checkedAt: new Date().toISOString(),
    version: require('../package.json').version,
    oneCurrentCard: true,
    currentVersion,
    automaticHotUpdateFromPreviousVersion: true,
    replacedRigClockDisposed: true,
    visibleBluePixelsInPublishedPreview: bluePixels,
    actualGeneratedDataRigLoaded: true,
    sixActionsEightEmotions: true,
    mouthEmotionChanges: true,
    waveMovesArm: true,
    manualGazeMovesPupil: true,
    blinkMovesExistingLid: true,
    headTilt: true,
    hiddenClockPaused: true,
    noGeneratedRuntimeScript: true,
    isolatedOffscreen: true,
    modelRequests: 0,
    deterministicBlinkSampleTime: 3.54,
    openWhiteEyePixels: frames[0],
    closedWhiteEyePixels: frames[1],
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    `Actual model-created v${currentVersion} character passed native library controls, visible badge and deterministic closed-eye sampling.`,
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
