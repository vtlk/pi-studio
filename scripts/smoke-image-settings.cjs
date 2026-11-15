const { app, BrowserWindow, safeStorage } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { readFile, readdir, rm, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const KEY = 'QA_SYNTHETIC_IMAGES_KEY_NOT_A_REAL_CREDENTIAL';
const REPLACEMENT = 'QA_SYNTHETIC_REPLACEMENT_NOT_A_REAL_CREDENTIAL';
let temporary,
  checks = 0,
  restricted = true;
const deadline = setTimeout(() => {
  console.error('Image settings smoke timed out');
  app.exit(1);
}, 60000);
// Main-process test dependency only: no request reaches OpenAI and no image is generated.
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.openai.com/')) return realFetch(url, init);
  assert.equal(String(url), 'https://api.openai.com/v1/models');
  assert.equal(init?.method, undefined);
  assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${KEY}`);
  checks++;
  if (restricted)
    return Response.json({ error: `Missing scopes: api.model.read. ${KEY}` }, { status: 403 });
  return Response.json({ data: [{ id: 'gpt-image-2.5-flare' }, { id: 'gpt-6' }] });
};
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-image-settings-'));
  for (const name of ['Videos', 'UserData']) mkdirSync(join(temporary, name));
  app.setPath('videos', join(temporary, 'Videos'));
  app.setPath('userData', join(temporary, 'UserData'));
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  const js = async (code) => {
    try {
      return await window.webContents.executeJavaScript(code, true);
    } catch (error) {
      throw new Error('Renderer action failed: ' + code.slice(0, 220), { cause: error });
    }
  };
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const input = (selector, value) =>
    js(
      `(() => { const element=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
  const select = async (label, option) => {
    await js(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
    );
    await until(`!!document.querySelector('[role="option"]')`);
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(element=>element.textContent.includes(${JSON.stringify(option)})).click()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('Подключения');
  await js(`document.querySelector('[aria-label="Добавить подключение"]').click()`);
  await input('[role="dialog"] .field-label input', 'QA Images');
  await select('Назначение подключения', 'Совместимый endpoint');
  await input('[aria-label="Адрес API модели"]', 'http://localhost:12345');
  await select('Назначение подключения', 'OpenAI Images API');
  await until(`!!document.querySelector('[aria-label="API-ключ изображений"]')`);
  assert.equal(
    await js(`document.querySelector('[aria-label="API-ключ изображений"]').disabled`),
    false,
  );
  await input('[aria-label="API-ключ изображений"]', KEY);
  await click('Сохранить');
  await until(`!document.querySelector('[role="dialog"]')`);
  await until(
    `document.querySelector('.resource-row small')?.textContent.includes('Ключ сохранён')`,
  );
  let state = await js('window.studio.loadStudio()');
  const connection = state.sections.connections[0],
    request = { folder: state.folder, connectionId: connection.id };
  assert.equal(connection.endpoint, '');
  assert.equal(JSON.stringify(state).includes(KEY), false);
  assert.equal(checks, 0);
  const vaultFiles = await readdir(join(temporary, 'UserData/secrets'));
  assert.equal(vaultFiles.length, 1);
  const encrypted = JSON.parse(
    await readFile(join(temporary, 'UserData/secrets', vaultFiles[0]), 'utf8'),
  );
  assert.equal(JSON.stringify(encrypted).includes(KEY), false);
  assert.equal(
    (await safeStorage.decryptStringAsync(Buffer.from(encrypted.encrypted, 'base64'))).result,
    KEY,
  );
  const readStatus = await js(`window.studio.readImageConnection(${JSON.stringify(request)})`);
  assert.equal(readStatus.keyStored, true);
  assert.equal(JSON.stringify(readStatus).includes(KEY), false);
  assert.equal(await js(`typeof window.studio.readSecret`), 'undefined');
  await click('Настроить');
  await until(
    `document.querySelector('[aria-label="API-ключ изображений"]')?.placeholder.includes('Ключ сохранён')`,
  );
  assert.equal(await js(`document.querySelector('[aria-label="API-ключ изображений"]').value`), '');
  await click('Проверить подключение');
  await until(`document.body.textContent.includes('List models → Read')`);
  await until(
    `Array.from(document.querySelectorAll('[role="status"]')).some(element=>element.textContent.includes('API ограничил доступ'))`,
  );
  assert.equal(
    (await js(`window.studio.readImageConnection(${JSON.stringify(request)})`)).authentication,
    'restricted',
  );
  assert.equal(await js(`document.body.textContent.includes(${JSON.stringify(KEY)})`), false);
  restricted = false;
  await click('Проверить подключение');
  await until(
    `Array.from(document.querySelectorAll('[role="status"]')).some(element=>element.textContent.includes('Ключ принят API'))`,
  );
  assert.equal(checks, 2);
  await click('Отмена');
  await click('Генерация изображений · внутренний MCP');
  await select('API-подключение генерации изображений', 'QA Images');
  assert.ok(
    (await js(`document.querySelector('[aria-label="Модель ImageGen"]').textContent`)).includes(
      'Выберите модель',
    ),
  );
  await select('Модель ImageGen', 'gpt-image-2.5-flare');
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  state = await js('window.studio.loadStudio()');
  assert.deepEqual(state.sections.imageTool, {
    connectionId: connection.id,
    modelId: 'gpt-image-2.5-flare',
  });
  assert.equal(checks, 2);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/images-settings.png'), (await window.capturePage()).toPNG());
  await click('Настроить');
  await input('[aria-label="API-ключ изображений"]', REPLACEMENT);
  await click('Сохранить');
  await until(`!document.querySelector('[role="dialog"]')`);
  const replaced = JSON.parse(
    await readFile(join(temporary, 'UserData/secrets', vaultFiles[0]), 'utf8'),
  );
  assert.equal(
    (await safeStorage.decryptStringAsync(Buffer.from(replaced.encrypted, 'base64'))).result,
    REPLACEMENT,
  );
  assert.equal(
    (await js(`window.studio.readImageConnection(${JSON.stringify(request)})`)).authentication,
    'unchecked',
  );
  await click('Настроить');
  await click('Удалить сохранённый ключ');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button=>button.textContent.trim()==='Отмена').click()`,
  );
  assert.equal(
    (await js(`window.studio.readImageConnection(${JSON.stringify(request)})`)).keyStored,
    true,
  );
  await click('Удалить сохранённый ключ');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button=>button.textContent.trim()==='Удалить ключ').click()`,
  );
  await until(`!document.querySelector('[role="alertdialog"]')`);
  await until(
    `!Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Удалить сохранённый ключ')`,
  );
  assert.equal(
    (await js(`window.studio.readImageConnection(${JSON.stringify(request)})`)).keyStored,
    false,
  );
  assert.deepEqual(await readdir(join(temporary, 'UserData/secrets')), []);
  state = await js('window.studio.loadStudio()');
  assert.equal(state.sections.connections.length, 1);
  assert.equal(state.sections.imageTool.connectionId, connection.id);
  assert.equal(JSON.stringify(state).includes(REPLACEMENT), false);
  console.log(
    'Image settings Electron passed: native safeStorage encryption/decryption with Chromium mock Keychain (no real OS credential access), blank masked re-entry, fixed-endpoint read-only API check, explicit model selection, key replacement and confirmed/cancelled deletion, no key getter or project secrets and zero image generation requests.',
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
