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
  require('../out/main/index.cjs');
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
      'Создание персонажа',
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
    `document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Выберите подключение и модель')`,
  );
  await assert.rejects(access(join(studio.folder, '.pistudio/library-runs')));
  await click('Отмена');
  dialog.showOpenDialog = originalChooser;
  const publish = (kind, title, id) =>
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
        ],
        { cwd: resolve(__dirname, '..'), encoding: 'utf8' },
      ),
    );
  const first = publish('characters', 'QA robot');
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
  const updated = publish('characters', 'QA revised robot', first.manifest.id);
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA revised robot'`);
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 1);
  assert.equal(updated.manifest.version, 2);
  await click('PNG-эталон');
  await until(
    `new URL(document.querySelector('.library-art img').src).pathname.endsWith('/reference.png') && document.querySelector('.library-art img')?.naturalWidth===32`,
  );
  assert.equal(await js(`document.querySelectorAll('script[src*="library-runtime"]').length`), 0);
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
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button=>button.textContent.trim()==='Библиотека').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Создать персонажа"]')`);
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 0);
  assert.equal((await js('window.studio.listLibrary()')).assets.length, 1);
  const location = publish('locations', 'QA room');
  await js(
    `Array.from(document.querySelectorAll('.segmented button')).find(button=>button.textContent.startsWith('Локации')).click()`,
  );
  await until(`document.querySelector('.library-stage h2')?.textContent==='QA room'`);
  await until(`document.querySelector('.location-camera img')?.naturalWidth>0`);
  await js(`document.querySelector('[aria-label="Увеличить камеру"]').click()`);
  assert.equal(await js(`document.querySelector('.camera-zoom output').textContent`), '125%');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/library-smoke.png'), (await window.capturePage()).toPNG());
  await writeFile(join(location.directory, 'art.svg'), '<svg onload="alert(1)"/>');
  await until(
    `document.querySelector('.error-message[role="alert"]')?.textContent.includes('SVG') && document.querySelectorAll('.asset-thumb-wrap').length===0`,
  );
  assert.equal((await js('window.studio.loadStudio()')).projects.length, 0);
  console.log(
    'Library Electron passed: empty start, external publish/update without restart, real PNG/SVG decoding, static character controls, scoped media, confirmed removal/cancel/undo/reload preserving source files, location camera and revalidation of changed files.',
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
