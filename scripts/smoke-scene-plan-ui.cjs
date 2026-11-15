const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdirSync, realpathSync, readFileSync, writeFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { join, resolve, basename, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

const root = realpathSync(process.env.PI_STUDIO_QA_SCENE_ROOT);
assert.match(basename(root), /^pistudio-scene-plan-[A-Za-z0-9]+$/);
assert.equal(dirname(root), realpathSync(tmpdir()));
const artifact = resolve('artifacts/scene-plan');
const proof = JSON.parse(readFileSync(join(artifact, 'proof.json'), 'utf8'));
const final = JSON.parse(readFileSync(join(artifact, 'planning.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(artifact, 'versions/2/asset.json'), 'utf8'));
const data = join(root, 'UiData');
mkdirSync(data, { recursive: true });
app.setPath('userData', data);
app.setPath('videos', root);
writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: join(root, 'Studio') }));
const timeout = setTimeout(() => fail(Error('Actual scene-plan UI timed out')), 45000);
async function fail(error) {
  console.error(error);
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action);
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => done(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.setAudioMuted(true);
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((done) => setTimeout(done, 40));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await click('Библиотека');
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().startsWith('Локации'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Локации')).click()`,
  );
  await until(
    `document.querySelector('.location-camera img')?.complete && document.querySelector('.location-camera img').naturalWidth>0`,
  );
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  assert.equal(await js(`document.querySelector('.library-stage h2').textContent`), manifest.title);
  assert.ok(
    await js(
      `document.querySelector('.location-camera img').src.includes(${JSON.stringify('/locations/' + proof.locationId + '/2/')})`,
    ),
  );
  assert.equal(await js(`!!document.querySelector('.library-controls')`), false);
  assert.equal(await js(`document.querySelectorAll('.camera-toolbar button').length`), 3);
  await js(`document.querySelector('[aria-label="Увеличить камеру"]').click()`);
  await until(
    `document.querySelector('.location-camera img').style.transform.includes('scale(1.25)')`,
  );
  await js(`document.querySelector('[aria-label="Увеличить камеру"]').click()`);
  await until(
    `document.querySelector('.location-camera img').style.transform.includes('scale(1.5)')`,
  );
  const before = await js(`document.querySelector('.location-camera img').style.transform`);
  await js(
    `(()=>{const group=document.querySelector('.location-camera'),img=group.querySelector('img');const fit=Math.min(group.clientWidth/img.naturalWidth,group.clientHeight/img.naturalHeight);const key=img.naturalWidth*fit*1.5>group.clientWidth+0.1?'ArrowRight':'ArrowDown';group.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));})()`,
  );
  await until(
    `document.querySelector('.location-camera img').style.transform!==${JSON.stringify(before)}`,
  );
  await js(`document.querySelector('[aria-label="Сбросить камеру"]').click()`);
  await until(
    `document.querySelector('.location-camera img').style.transform==='translate(0px, 0px) scale(1)'`,
  );
  await click('PNG-эталон');
  await until(
    `document.querySelector('.location-camera img')?.complete && document.querySelector('.location-camera img').naturalWidth>0 && document.querySelector('.location-camera img').src.includes('reference.png')`,
  );
  await click('SVG');
  await until(
    `document.querySelector('.location-camera img')?.complete && document.querySelector('.location-camera img').naturalWidth>0 && document.querySelector('.location-camera img').src.includes('location.svg')`,
  );
  await writeFile(join(artifact, 'studio-location.png'), (await window.capturePage()).toPNG());
  await click('Проекты');
  await until(`!!document.querySelector('[aria-label="Открыть проект «Фонарь у маяка — QA»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Фонарь у маяка — QA»"]').click()`);
  await until(`!!document.querySelector('.output-file-tree')`);
  await js(
    `Array.from(document.querySelectorAll('.file-tree-folder[aria-expanded="false"]')).find(b=>b.textContent.trim()==='output')?.click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.file-tree-folder')).some(b=>b.textContent.trim()==='scenes')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-folder[aria-expanded="false"]')).find(b=>b.textContent.trim()==='scenes')?.click()`,
  );
  const name = final.scenes[0].id + '.md';
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()===${JSON.stringify(name)})`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
  );
  await until(`!!document.querySelector('.output-markdown h1')`);
  const text = await js(`document.querySelector('.output-markdown').textContent`);
  assert.ok(text.includes('Этот фонарь поможет путникам'));
  assert.ok(text.includes('Терраса у маяка') && text.includes('Руби'));
  assert.ok(!text.includes('Бим'));
  assert.ok(await js(`document.querySelectorAll('.output-markdown strong').length>=5`));
  assert.ok(
    !(await js(
      `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()===${JSON.stringify(final.removed.sceneIds[0] + '.md')})`,
    )),
  );
  assert.equal(
    await js(
      `!!document.querySelector('.output-markdown textarea, .output-markdown input, .output-markdown [contenteditable="true"]')`,
    ),
    false,
  );
  assert.equal(window.isVisible(), false);
  await writeFile(join(artifact, 'studio-scene-card.png'), (await window.capturePage()).toPNG());
  proof.nativeUi = {
    checkedAt: new Date().toISOString(),
    version: require('../package.json').version,
    actualGeneratedLocationV2Loaded: true,
    oneCurrentLocationCard: true,
    svgAndReferencePngLoad: true,
    zoomPanReset: true,
    noCharacterControlsForLocation: true,
    actualRemainingSceneMarkdownRendered: true,
    deletedSceneAbsentFromTree: true,
    noRemovedDogInCard: true,
    readOnlySceneCard: true,
    isolatedOffscreen: true,
    newModelRequests: 0,
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    'Actual scene plan passed native UI: published location SVG/PNG, zoom/pan/reset, one current card, remaining formatted scene file and deleted scene absent.',
  );
  clearTimeout(timeout);
  for (const current of BrowserWindow.getAllWindows()) current.destroy();
  app.exit(0);
})().catch(fail);
