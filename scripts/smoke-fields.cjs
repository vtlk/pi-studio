const { app, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const deadline = setTimeout(() => {
  console.error('Field style smoke timed out');
  app.exit(1);
}, 30000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-fields-'));
  for (const key of ['videos', 'userData']) {
    const p = join(root, key);
    mkdirSync(p);
    app.setPath(key, p);
  }
  let loadFailure = false;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : channel === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : channel === 'studio:load'
            ? (...args) => {
                if (loadFailure) throw new Error('QA storage unavailable');
                return action(...args);
              }
            : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.setSize(1280, 900);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('../out/main/index.cjs');
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA reload before saved');
    app.exit(1);
  });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const properties = [
    'display',
    'width',
    'height',
    'min-height',
    'max-height',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'border-top-width',
    'border-top-color',
    'border-top-style',
    'border-top-left-radius',
    'border-bottom-right-radius',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'box-shadow',
    'opacity',
  ];
  const samples = {};
  const sample = async (name, selector) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    samples[name] = await js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(el);return Object.fromEntries(${JSON.stringify(properties)}.map(p=>[p,s.getPropertyValue(p)]));})()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await sample('name', '[aria-label="Название агента"]');
  await sample('prompt', '[aria-label="Основной промпт агента"]');
  await click('Модель');
  await until(
    `!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Обновляем каталог'))`,
  );
  await sample('connection', '[aria-label="Подключение модели"]');
  await sample('model', '[aria-label="Модель агента"]');
  await sample('reasoning', '[aria-label="Уровень рассуждения (effort)"]');
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await sample('workspace', '.settings-field-row input');
  const file = resolve('artifacts/fields-before.json');
  if (process.argv.includes('--baseline')) {
    await mkdir(resolve('artifacts'), { recursive: true });
    await writeFile(file, JSON.stringify(samples, null, 2) + '\n');
  } else {
    if (process.argv.includes('--compare'))
      assert.deepEqual(
        samples,
        JSON.parse(await readFile(file, 'utf8')),
        'Accepted field appearance changed',
      );
    for (const [name, style] of Object.entries(samples)) {
      assert.equal(style['border-top-left-radius'], '0px', name);
      assert.equal(style['box-shadow'], 'none', name);
    }
  }
  if (!process.argv.includes('--baseline')) {
    await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
    loadFailure = true;
    window.webContents.reload();
    await until(`!!document.querySelector('.startup-screen input')`);
    const startup = await js(
      `(()=>{const s=getComputedStyle(document.querySelector('.startup-screen input'));return {radius:s.borderTopLeftRadius,shadow:s.boxShadow};})()`,
    );
    assert.deepEqual(startup, { radius: '0px', shadow: 'none' });
  }
  clearTimeout(deadline);
  console.log(
    'Field styles passed: name, tall prompt, connection/model/reasoning and workspace fields.',
  );
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (e) => {
  clearTimeout(deadline);
  console.error(e);
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
