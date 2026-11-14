const { app, BrowserWindow, dialog } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { writeFile, rm, mkdir, access } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Library smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-library-desktop-'));
  const videos = join(temporary, 'Videos'),
    userData = join(temporary, 'UserData');
  mkdirSync(videos);
  mkdirSync(userData);
  app.setPath('videos', videos);
  app.setPath('userData', userData);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Failed library expression:', code.slice(0, 180));
      throw error;
    });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error('Library state:', await js('document.body.innerText.slice(-2000)'));
    throw new Error('Library assertion timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const studio = await js('window.studio.loadStudio()');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const agent = {
    id: 'qa-library-artist',
    name: 'QA library artist',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: ['pistudio-library'],
    plugins: [],
  };
  for (const [section, value] of [
    ['agents', [agent]],
    ['libraryAgents', { characters: agent.id, locations: agent.id }],
  ])
    await js(
      `window.studio.saveSection(${JSON.stringify(section)},${JSON.stringify(value)},${JSON.stringify({ folder: studio.folder, base: studio.sections[section] })})`,
    );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual((await js('window.studio.listLibrary()')).assets, []);
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button=>button.textContent.trim()==='Библиотека').click()`,
  );
  const reference = join(temporary, 'reference.svg');
  await writeFile(
    reference,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/><path d="M50 10L90 90H10Z" fill="red"/></svg>',
  );
  const originalChooser = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [reference] });
  await js(`document.querySelector('[aria-label="Создать персонажа"]').click()`);
  await until(`!!document.querySelector('[role="dialog"] textarea')`);
  assert.ok(
    (await js(`document.querySelector('[role="dialog"]').textContent`)).includes(
      'QA library artist',
    ),
  );
  await js(`document.querySelector('[aria-label="Прикрепить файлы референса"]').click()`);
  await until(`document.querySelector('.reference-thumbnail img')?.naturalWidth>0`);
  await js(`document.querySelector('[aria-label="Убрать референс «reference.svg»"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button=>button.textContent.trim()==='Отмена').click()`,
  );
  assert.equal(await js(`document.querySelectorAll('.reference-attachment').length`), 1);
  await click('Отмена');
  await assert.rejects(access(join(studio.folder, '.pistudio/library-runs')));
  await js(`document.querySelector('[aria-label="Создать персонажа"]').click()`);
  await js(
    `(()=>{const textarea=document.querySelector('[role="dialog"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Create a test character');textarea.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    `!Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Создать с Pi').disabled`,
  );
  await click('Создать с Pi');
  await until(
    `document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Выберите подключение')`,
  );
  await assert.rejects(access(join(studio.folder, '.pistudio/library-runs')));
  await click('Отмена');
  dialog.showOpenDialog = originalChooser;
  const publish = (kind, title, id, category) =>
    JSON.parse(
      execFileSync(
        'node',
        [
          '--experimental-strip-types',
          'scripts/fixtures/publish-library.ts',
          studio.folder,
          kind,
          title,
          ...(id ? [id] : []),
          ...(category ? [`--category=${category}`] : []),
        ],
        { cwd: resolve(__dirname, '..'), encoding: 'utf8' },
      ),
    );
  const first = publish('characters', 'QA robot', undefined, 'Robots');
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA robot'`);
  await until(
    `document.querySelector('.library-art img')?.naturalWidth>0 && new URL(document.querySelector('.library-art img').src).pathname.endsWith('/art.svg')`,
  );
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[aria-label="Анимация персонажа"] button')).every(button=>button.disabled)`,
    ),
    true,
  );
  assert.equal(await js(`document.body.innerText.includes('Статичный материал')`), true);
  const vector = await js(`document.querySelector('.library-art img').src`);
  assert.match(vector, /^studio-media:\/\/library\//);
  assert.equal(
    await js(
      `fetch(new URL('asset.json',${JSON.stringify(vector)})).then(response=>response.status)`,
    ),
    404,
  );
  const updated = publish('characters', 'QA revised robot', first.manifest.id, 'Robots');
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA revised robot'`);
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  assert.equal(updated.manifest.version, 2);
  await click('PNG-эталон');
  await until(
    `new URL(document.querySelector('.library-art img').src).pathname.endsWith('/reference.png') && document.querySelector('.library-art img')?.naturalWidth===32`,
  );
  assert.equal(await js(`document.querySelectorAll('script[src*="library-runtime"]').length`), 0);
  await js(`document.querySelector('[aria-label="Категория библиотеки"]').click()`);
  await until(`!!document.querySelector('[role="option"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent==='Robots').click()`,
  );
  const remove = () =>
    js(`document.querySelector('[aria-label="Удалить QA revised robot"]').click()`);
  await remove();
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  await click('Отмена');
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  await remove();
  await click('Удалить');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===0`);
  await access(join(updated.directory, 'reference.png'));
  await click('Вернуть');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===1`);
  await remove();
  await click('Удалить');
  const fresh = publish('characters', 'QA fresh robot');
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA fresh robot'`);
  assert.equal(
    await js(`document.querySelectorAll('.asset-thumb-wrap').length`),
    1,
    'A vanished category must not invisibly filter new uncategorized assets',
  );
  publish('characters', 'QA category returned', undefined, 'Robots');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===2`);
  assert.ok(
    (
      await js(`document.querySelector('[aria-label="Категория библиотеки"]').textContent`)
    ).includes('Все категории'),
    'A vanished category must not reactivate when new assets reuse its name',
  );
  await js(`document.querySelector('[aria-label="Удалить QA category returned"]').click()`);
  await click('Удалить');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===1`);
  await js(`document.querySelector('[aria-label="Удалить QA fresh robot"]').click()`);
  await click('Удалить');
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button=>button.textContent.trim()==='Библиотека').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Создать персонажа"]')`);
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 0);
  assert.equal((await js('window.studio.listLibrary()')).assets.length, 3);
  const location = publish('locations', 'QA room');
  await js(
    `Array.from(document.querySelectorAll('.segmented button')).find(button=>button.textContent.startsWith('Локации')).click()`,
  );
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA room'`);
  await until(`document.querySelector('.location-camera img')?.naturalWidth>0`);
  await js(`document.querySelector('[aria-label="Увеличить камеру"]').click()`);
  assert.equal(await js(`document.querySelector('.camera-zoom output').textContent`), '125%');
  await js(
    `(()=>{const input=document.querySelector('[aria-label="Масштаб камеры"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'4');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(`document.querySelector('.camera-zoom output').textContent==='400%'`);
  await js(
    `document.querySelector('.location-camera').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
  );
  const shifted = await js(`document.querySelector('.location-camera img').style.transform`);
  assert.match(shifted, /translate\(-30px/);
  const rect = await js(
    `(()=>{const r=document.querySelector('.location-camera').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  for (const event of [
    { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 },
    { type: 'mouseMoved', x: rect.x + 80, y: rect.y + 40, button: 'left', buttons: 1 },
    {
      type: 'mouseReleased',
      x: rect.x + 80,
      y: rect.y + 40,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
  ])
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', event);
  const dragged = await js(`document.querySelector('.location-camera img').style.transform`);
  assert.notEqual(dragged, shifted, 'Pointer drag must move the zoomed image');
  await js(`document.querySelector('[aria-label="Сбросить камеру"]').click()`);
  assert.equal(
    await js(`document.querySelector('.location-camera img').style.transform`),
    'translate(0px, 0px) scale(1)',
  );
  assert.equal(await js(`document.querySelector('.camera-zoom output').textContent`), '100%');
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const cameraGeometry = await js(
    `(()=>{const el=document.querySelector('.location-camera'), img=el.querySelector('img');return{width:el.clientWidth,height:el.clientHeight,transform:getComputedStyle(img).transform,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}})()`,
  );
  assert.ok(Math.abs(cameraGeometry.width / cameraGeometry.height - 16 / 9) < 0.01);
  assert.equal(cameraGeometry.transform, 'matrix(1, 0, 0, 1, 0, 0)');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/library-smoke.png'), (await window.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="Удалить QA room"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Отмена');
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  await js(`document.querySelector('[aria-label="Удалить QA room"]').click()`);
  await click('Удалить');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===0`);
  await access(join(location.directory, 'reference.png'));
  await click('Вернуть');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===1`);
  await writeFile(join(location.directory, 'art.svg'), '<svg onload="alert(1)"/>');
  await until(
    `document.querySelector('.error-message[role="alert"]')?.textContent.includes('SVG') && document.querySelectorAll('.asset-thumb-wrap').length===0`,
  );
  publish('characters', 'QA older', undefined, 'Group A');
  publish('characters', 'QA middle', undefined, 'Group B');
  publish('characters', 'QA newer', undefined, 'Group A');
  await js(
    `Array.from(document.querySelectorAll('.segmented button')).find(button=>button.textContent.startsWith('Персонажи')).click()`,
  );
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===3`);
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.asset-thumb-wrap .asset-thumb span')).map(el=>el.textContent)`,
    ),
    ['QA newer', 'QA middle', 'QA older'],
  );
  assert.equal(
    await js(
      `document.querySelector('.asset-strip > :first-child button')?.getAttribute('aria-label') ?? document.querySelector('.asset-strip > :first-child')?.getAttribute('aria-label')`,
    ),
    'Создать персонажа',
  );
  const search = async (value) =>
    js(
      `(()=>{const input=document.querySelector('[aria-label="Поиск в библиотеке"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await search('MIDDLE');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===1`);
  assert.equal(await js(`document.querySelector('.library-stage h2').textContent`), 'QA middle');
  await search('nothing matches');
  await until(`document.querySelector('.no-results')?.textContent==='Ничего не найдено.'`);
  assert.equal(await js(`!!document.querySelector('.library-viewer')`), false);
  await search('');
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===3`);
  await js(`document.querySelector('[aria-label="Категория библиотеки"]').click()`);
  await until(`!!document.querySelector('[role="option"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent==='Group A').click()`,
  );
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===2`);
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.asset-thumb-wrap .asset-thumb span')).map(el=>el.textContent)`,
    ),
    ['QA newer', 'QA older'],
  );
  assert.equal((await js('window.studio.loadStudio()')).projects.length, 0);
  console.log(
    JSON.stringify({
      passed: true,
      emptyStart: true,
      ordinaryAgentReferenceCancelPreflight: true,
      publishUpdateSingleCard: true,
      searchCategoryOrderPlus: true,
      vanishedCategoryRegression: true,
      categoryDoesNotReactivate: true,
      nativePngSvg: true,
      staticControls: true,
      scopedMedia: true,
      characterAndLocationConfirmedDeleteUndo: true,
      persistentHiddenIdsPreserveSources: true,
      locationZoomPointerKeyboardReset: true,
      cameraGeometry,
      externalInvalidSvgRejected: true,
      modelRequests: 0,
      publisher: 'production LibraryStore fixture, not LLM',
    }),
  );
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporary)
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
