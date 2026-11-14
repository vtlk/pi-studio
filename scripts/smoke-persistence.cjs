const { app } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
let root;
const deadline = setTimeout(() => {
  console.error('Persistence smoke timed out');
  app.exit(1);
}, 45000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-persistence-ui-'));
  const videos = join(root, 'Videos'),
    userData = join(root, 'UserData');
  mkdirSync(videos);
  mkdirSync(userData);
  app.setPath('videos', videos);
  app.setPath('userData', userData);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('../out/main/index.cjs');
  const window = await loaded;
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA navigation before saved');
    app.exit(1);
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const setName = (value) =>
    js(
      `(()=>{const input=document.querySelector('[aria-label="Название агента"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const saved = () =>
    until(
      `document.querySelector('.prototype-label')?.textContent.includes('Сохранено') && !document.querySelector('.storage-error')`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`!!document.querySelector('[aria-label="Название агента"]')`);
  await setName('Original');
  await saved();
  // Perform a real competing write and local edit in the same task before background refresh.
  await js(
    `(async()=>{const before=await window.studio.loadStudio();const changed=structuredClone(before.sections.agents);changed[0].name='Changed in Pi';const result=await window.studio.saveSection('agents',changed,{folder:before.folder,base:before.sections.agents});if(!result.saved)throw Error('Fixture write failed');const input=document.querySelector('[aria-label="Название агента"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'My unsaved draft');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    `document.querySelector('[role="alertdialog"]')?.textContent.includes('Настройки изменились')`,
  );
  assert.equal(
    await js(`document.querySelector('[aria-label="Название агента"]').value`),
    'My unsaved draft',
  );
  assert.equal(
    await js(`window.studio.loadStudio().then(s=>s.sections.agents[0].name)`),
    'Changed in Pi',
  );
  await click('Вернуться к моим правкам');
  assert.equal(
    await js(`document.querySelector('[aria-label="Название агента"]').value`),
    'My unsaved draft',
  );
  await js(`document.querySelector('.storage-error button').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(b=>b.textContent.trim()==='Перечитать раздел').click()`,
  );
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Changed in Pi'`);
  await saved();
  await setName('Saved after reload');
  await saved();
  assert.equal(
    await js(`window.studio.loadStudio().then(s=>s.sections.agents[0].name)`),
    'Saved after reload',
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await until(
    `document.querySelector('[aria-label="Название агента"]')?.value==='Saved after reload'`,
  );
  await saved();
  clearTimeout(deadline);
  console.log(
    'Persistence UI passed: actual competing IPC save, retained local draft, cancel, explicit reload, subsequent autosave and disk hydration; isolated hidden window.',
  );
  app.exit(0);
})().catch((error) => {
  clearTimeout(deadline);
  console.error(error);
  app.exit(1);
});
app.on('will-quit', () => {
  if (root) void rm(root, { recursive: true, force: true });
});
