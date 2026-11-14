const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { writeFile, mkdir, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
let temporary;
const timeout = setTimeout(() => {
  console.error('Character rig Electron timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-character-rig-'));
  for (const name of ['Videos', 'UserData']) mkdirSync(join(temporary, name));
  app.setPath('videos', join(temporary, 'Videos'));
  app.setPath('userData', join(temporary, 'UserData'));
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Failed rig expression:', code);
      throw error;
    });
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await sleep(75);
    }
    console.error(await js('document.body.innerText.slice(-1500)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const transform = (part) =>
    js(
      `document.querySelector('[data-rig-transform=${JSON.stringify(part)}]').getAttribute('transform')`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const studio = await js('window.studio.loadStudio()');
  const published = JSON.parse(
    execFileSync(
      'node',
      [
        '--experimental-strip-types',
        'scripts/fixtures/publish-library.ts',
        studio.folder,
        'characters',
        'QA dynamic artist',
        '--rig',
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8' },
    ),
  );
  assert.equal(published.asset.library.animated, true);
  await click('Библиотека');
  await until(`!!document.querySelector('[data-character-engine="pistudio-character-1"]')`);
  assert.equal(await js(`document.querySelectorAll('script[src*="library-runtime"]').length`), 0);
  assert.equal(
    await js(`document.querySelectorAll('[aria-label="Действие"] button:not(:disabled)').length`),
    6,
  );
  assert.equal(
    await js(`document.querySelectorAll('[aria-label="Эмоция"] button:not(:disabled)').length`),
    8,
  );
  const first = await transform('body');
  await until(
    `document.querySelector('[data-rig-transform="body"]').getAttribute('transform')!==${JSON.stringify(first)}`,
  );
  const labels = ['Спокойно', 'Ходить', 'Бежать', 'Махать', 'Двигать руками', 'Думать'];
  const actionFrames = new Set();
  const screenshots = [];
  const capture = async (label) => {
    const rect = await js(
      `(()=>{const r=document.querySelector('.library-art').getBoundingClientRect(),width=Math.min(r.width,r.height*2/3+40);return {x:Math.round(r.x+(r.width-width)/2),y:Math.round(r.y),width:Math.round(width),height:Math.round(r.height)};})()`,
    );
    screenshots.push({ label, png: (await window.capturePage(rect)).toDataURL() });
  };
  for (const label of labels) {
    await click(label);
    await sleep(250);
    actionFrames.add((await transform('arm-left')) + (await transform('leg-left')));
    await capture(label);
  }
  assert.equal(actionFrames.size, 6);
  await click('Спокойно');
  const expressions = new Set();
  for (const label of [
    'Безразличие',
    'Улыбка',
    'Ухмылка',
    'Страх',
    'Грусть',
    'Злость',
    'Удивление',
    'Задумчивость',
  ]) {
    await click(label);
    await sleep(400);
    expressions.add(await js(`document.querySelector('[data-part="mouth"]').getAttribute('d')`));
    await capture(label);
  }
  assert.equal(expressions.size, 8);
  for (const [label, x, y] of [
    ['Влево-вверх', -6, -6],
    ['Вверх', 0, -6],
    ['Вправо-вверх', 6, -6],
    ['Влево', -6, 0],
    ['Прямо', 0, 0],
    ['Вправо', 6, 0],
    ['Влево-вниз', -6, 6],
    ['Вниз', 0, 6],
    ['Вправо-вниз', 6, 6],
  ]) {
    await js(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
    await sleep(400);
    const pupils = await js(
      `Array.from(document.querySelectorAll('[data-rig-transform^="pupil-"]')).map(element=>{const matrix=element.transform.baseVal.getItem(0).matrix;return [matrix.e,matrix.f];})`,
    );
    for (const pair of pupils) {
      assert.ok(Math.abs(pair[0] - x) < 0.1);
      assert.ok(Math.abs(pair[1] - y) < 0.1);
    }
  }
  await click('Безразличие');
  await sleep(300);
  await click('Моргнуть');
  await sleep(130);
  const lidClosed = await js(`document.querySelector('[data-part="lid-left"]').getAttribute('d')`);
  await sleep(350);
  assert.notEqual(
    lidClosed,
    await js(`document.querySelector('[data-part="lid-left"]').getAttribute('d')`),
  );
  assert.equal(await js(`document.querySelectorAll('[data-part="lid-left"]').length`), 1);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  const hidden = await transform('body');
  await sleep(250);
  assert.equal(await transform('body'), hidden);
  await js(
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await sleep(250);
  assert.notEqual(await transform('body'), hidden);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await sleep(150);
  const range = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await click('Ходить');
  await click('Улыбка');
  assert.equal(
    await js(
      `document.querySelector('[aria-label="Действие"] [aria-pressed="true"]').textContent.trim()`,
    ),
    'Ходить',
  );
  assert.equal(
    await js(
      `document.querySelector('[aria-label="Эмоция"] [aria-pressed="true"]').textContent.trim()`,
    ),
    'Улыбка',
  );
  const smile = await js(`document.querySelector('[data-part="mouth"]').getAttribute('d')`);
  await range('Выразительность', 0);
  assert.notEqual(
    await js(`document.querySelector('[data-part="mouth"]').getAttribute('d')`),
    smile,
  );
  await range('Выразительность', 1);
  assert.equal(await js(`document.querySelector('[data-part="mouth"]').getAttribute('d')`), smile);
  await click('Спокойно');
  await click('Безразличие');
  await range('Наклон головы', 7);
  assert.match(await transform('head'), /rotate\(7 /);
  await range('Наклон головы', 0);
  const still = await transform('body');
  await sleep(200);
  assert.equal(await transform('body'), still);
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  window.webContents.debugger.detach();
  assert.equal(
    await js(`document.querySelector('[aria-label="Живой взгляд"]').getAttribute('aria-checked')`),
    'false',
  );
  await js(`document.querySelector('[aria-label="Живой взгляд"]').click()`);
  assert.equal(
    await js(`document.querySelector('[aria-label="Живой взгляд"]').getAttribute('aria-checked')`),
    'true',
  );
  const pupil = await transform('pupil-left');
  await until(
    `document.querySelector('[data-rig-transform="pupil-left"]').getAttribute('transform')!==${JSON.stringify(pupil)}`,
  );
  await js(`document.querySelector('[aria-label="Прямо"]').click()`);
  assert.equal(
    await js(`document.querySelector('[aria-label="Живой взгляд"]').getAttribute('aria-checked')`),
    'false',
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.character-controls button')).some(el=>/Пауза|Сброс/.test(el.textContent))`,
    ),
    false,
  );
  await js(`window.__qaOldSvg=document.querySelector('[data-character-engine]')`);
  await click('PNG-эталон');
  await until(
    `document.querySelectorAll('[data-character-engine]').length===0 && document.querySelectorAll('[aria-label="Действие"] button:not(:disabled)').length===0`,
  );
  const detached = await js(
    `window.__qaOldSvg.querySelector('[data-rig-transform="body"]').getAttribute('transform')`,
  );
  await sleep(250);
  assert.equal(
    await js(
      `window.__qaOldSvg.querySelector('[data-rig-transform="body"]').getAttribute('transform')`,
    ),
    detached,
  );
  await click('SVG');
  await until(`document.querySelectorAll('[data-character-engine]').length===1`);
  const data = await js(
    `window.studio.readLibraryCharacter(${JSON.stringify(published.manifest.id)},1,${JSON.stringify(published.asset.library.revision)})`,
  );
  const ids = await js(
    `Array.from(document.querySelectorAll('.animated-character [id]')).map(element=>element.id)`,
  );
  assert.ok(ids.every((id) => id.startsWith('preview-')));
  assert.ok(data.svg && data.rig);
  assert.equal(
    await js(
      `window.studio.readLibraryCharacter(${JSON.stringify(published.manifest.id)},1,'stale').then(()=>false,()=>true)`,
    ),
    true,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  const sheet = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await sheet.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<style>body{margin:0;background:#eee;font:16px system-ui;display:grid;grid-template-columns:repeat(5,1fr)}figure{margin:8px;background:white;text-align:center}img{width:100%;height:270px;object-fit:contain}</style>${screenshots.map((frame) => `<figure><img src="${frame.png}"><figcaption>${frame.label}</figcaption></figure>`).join('')}`,
      ),
  );
  await sheet.webContents.executeJavaScript(
    'Promise.all(Array.from(document.images).map(image=>image.decode())).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))',
  );
  await writeFile(
    resolve('artifacts/character-rig-sheet.png'),
    (await sheet.capturePage()).toPNG(),
  );
  sheet.destroy();
  await js(`window.__qaOldSvg=document.querySelector('[data-character-engine]')`);
  await click('Проекты');
  const unmounted = await js(
    `window.__qaOldSvg.querySelector('[data-rig-transform="body"]').getAttribute('transform')`,
  );
  await sleep(250);
  assert.equal(
    await js(
      `window.__qaOldSvg.querySelector('[data-rig-transform="body"]').getAttribute('transform')`,
    ),
    unmounted,
  );
  console.log(
    JSON.stringify({
      passed: true,
      actions: actionFrames.size,
      emotions: expressions.size,
      gazeDirections: 9,
      intensityAndTilt: true,
      independentChoices: true,
      liveGazeAndManualOverride: true,
      existingEyelidBlink: true,
      revisionAndScopedIds: true,
      generatedScriptsLoaded: 0,
      pngAndUnmountStopDetachedSvg: true,
      visibilityAndReducedMotion: true,
      visibilityScope: 'simulated-event-offscreen',
      modelRequests: 0,
    }),
  );
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporary)
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
