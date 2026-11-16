const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const assert = require('node:assert/strict');
let root, server;
const deadline = setTimeout(() => {
  console.error('Endpoint UI timed out');
  app.exit(1);
}, 90000);
(async () => {
  const received = [];
  server = createServer((req, res) => {
    received.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'qa-one' }, { id: 'qa-two' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  root = mkdtempSync(join(tmpdir(), 'pistudio-endpoint-ui-'));
  for (const name of ['Videos', 'UserData']) mkdirSync(join(root, name));
  app.setPath('videos', join(root, 'Videos'));
  app.setPath('userData', join(root, 'UserData'));
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(await js('document.body.innerText.slice(-3000)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const fill = (selector, value) =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const select = async (label, text) => {
    await js(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
    );
    await until(`!!document.querySelector('[role="option"]')`);
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent.includes(${JSON.stringify(text)})).click()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(`document.querySelector('.settings-button').click()`);
  await click('Подключения');
  await js(`document.querySelector('[aria-label="Добавить подключение"]').click()`);
  await fill('[role="dialog"] input', 'QA local server');
  await select('Назначение подключения', 'Локальная модель');
  await fill('[aria-label="Адрес API модели"]', endpoint);
  assert.equal(
    await js(`!!document.querySelector('[aria-label="Область авторизации Pi"]')`),
    false,
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).some(el=>el.textContent==='Войти через Pi')`,
    ),
    false,
  );
  await click('Прочитать модели сервера');
  await until(`document.querySelectorAll('[role="dialog"] .disclosure').length===2`);
  assert.deepEqual(received, [{ url: '/v1/models', auth: undefined }]);
  await click('qa-one');
  await js(`document.querySelector('[aria-label="Изображения модели 1"]').click()`);
  await until(
    `document.querySelector('[aria-label="Изображения модели 1"]').getAttribute('aria-checked')==='true'`,
  );
  await js(`document.querySelector('[aria-label="Рассуждение модели 1"]').click()`);
  await until(
    `document.querySelector('[aria-label="Рассуждение модели 1"]').getAttribute('aria-checked')==='true'`,
  );
  await js(`document.querySelector('[aria-label="Удалить модель qa-two"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('[role="alertdialog"] button').click()`);
  assert.equal(await js(`document.querySelectorAll('[role="dialog"] .disclosure').length`), 2);
  await js(`document.querySelector('[aria-label="Удалить модель qa-two"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('[role="alertdialog"] .button.primary').click()`);
  await until(`document.querySelectorAll('[role="dialog"] .disclosure').length===1`);
  await click('Сохранить');
  await until(`!document.querySelector('[role="dialog"]')`);
  const state = await js('window.studio.loadStudio()');
  assert.equal(state.sections.connections.length, 1);
  const connection = state.sections.connections[0];
  assert.equal(connection.endpoint, endpoint);
  assert.equal(connection.endpointConfig.auth, 'none');
  assert.equal(connection.endpointConfig.models[0].imageInput, true);
  assert.equal(connection.endpointConfig.models[0].reasoning, true);
  assert.equal(connection.providerId, 'studio-' + connection.id);
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await click('Модель');
  await select('Подключение модели', 'QA local server');
  await until(`!document.querySelector('[aria-label="Модель агента"]').disabled`);
  await select('Модель агента', 'qa-one');
  await select('Уровень рассуждения (effort)', 'Низкий');
  await until(
    `(async()=>{const saved=await window.studio.loadStudio();return saved.sections.agents[0].model.id==='qa-one'&&saved.sections.agents[0].model.reasoning==='Низкий'})()`,
  );
  // Search is local to the open picker; cancelling or an empty result never changes the profile.
  await js(`document.querySelector('[aria-label="Модель агента"]').click()`);
  await until(`document.activeElement?.getAttribute('role')==='combobox'`);
  await fill('[placeholder="Найти модель"]', 'NO-SUCH-MODEL');
  await until(`!!document.querySelector('.ui-select-empty')`);
  assert.equal(await js(`document.querySelectorAll('[role="option"]').length`), 0);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  assert.equal((await js('window.studio.loadStudio()')).sections.agents[0].model.id, 'qa-one');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(`!document.querySelector('.ui-searchable-select')`);
  await until(`document.activeElement?.getAttribute('aria-label')==='Модель агента'`);
  await js(`document.querySelector('[aria-label="Модель агента"]').click()`);
  await until(`document.activeElement?.getAttribute('role')==='combobox'`);
  assert.equal(await js(`document.querySelector('[placeholder="Найти модель"]').value`), '');
  await fill('[placeholder="Найти модель"]', 'QA-ONE');
  await until(`document.querySelectorAll('[role="option"]').length===1`);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/agent-model-search.png'), (await window.capturePage()).toPNG());
  for (const keyCode of ['Down', 'Up', 'Enter']) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
  await until(`!document.querySelector('.ui-searchable-select')`);
  assert.equal(received.length, 1, 'Searching must not call the provider');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/agent-model-panel.png'), (await window.capturePage()).toPNG());
  const fields = await js(
    `Array.from(document.querySelectorAll('.agent-model-fields .ui-select-trigger')).map(el=>({y:el.getBoundingClientRect().y,h:el.offsetHeight}))`,
  );
  assert.equal(
    new Set(fields.map((item) => item.y)).size,
    1,
    'All three model fields stay in one row',
  );
  await click('Промпт');
  const prompt = await js(
    `(()=>{const el=document.querySelector('[aria-label="Основной промпт агента"]');return {height:el.offsetHeight,margin:getComputedStyle(el).margin,top:el.getBoundingClientRect().top,bodyTop:document.querySelector('.agent-settings-body').getBoundingClientRect().top,label:!!el.closest('label')}})()`,
  );
  assert.ok(prompt.height >= 360);
  assert.equal(prompt.margin, '0px');
  assert.equal(prompt.top, prompt.bodyTop);
  assert.equal(prompt.label, false);
  await writeFile(
    resolve('artifacts/agent-prompt-panel.png'),
    (await window.capturePage()).toPNG(),
  );
  await click('Модель');
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  const saved = await js('window.studio.loadStudio()');
  assert.equal(saved.sections.agents[0].model.connectionId, connection.id);
  assert.equal(saved.sections.agents[0].model.id, 'qa-one');
  assert.equal(saved.sections.agents[0].model.reasoning, 'Низкий');
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(`document.querySelector('.settings-button').click()`);
  await click('Подключения');
  await click('Настроить');
  await until(`!!document.querySelector('[aria-label="Адрес API модели"]')`);
  assert.equal(
    await js(`document.querySelector('[aria-label="Адрес API модели"]').value`),
    endpoint,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/endpoint-settings.png'), (await window.capturePage()).toPNG());
  await click('Отмена');
  const notice = {
    projectRoot: state.folder + '/projects/qa',
    projectId: 'qa',
    agentId: 'one',
    agentName: 'QA agent',
    failure: 'usage_limit',
    rawError: 'PRIVATE_PROVIDER_DETAIL',
  };
  window.webContents.send('studio:run-failure', notice);
  await until(
    `document.querySelector('.run-failure-notice')?.textContent.includes('Достигнут лимит')`,
  );
  assert.equal(
    await js(
      `document.querySelector('.run-failure-notice').textContent.includes('PRIVATE_PROVIDER_DETAIL')`,
    ),
    false,
  );
  window.webContents.send('studio:run-failure', {
    ...notice,
    projectRoot: '/unrelated/studio/project',
    failure: 'network',
  });
  await js(`new Promise(resolve=>requestAnimationFrame(resolve))`);
  assert.equal(
    await js(
      `document.querySelector('.run-failure-notice').textContent.includes('Достигнут лимит')`,
    ),
    true,
  );
  window.webContents.send('studio:run-failure', {
    ...notice,
    agentId: 'other',
    failure: undefined,
  });
  await js(`new Promise(resolve=>requestAnimationFrame(resolve))`);
  assert.equal(await js(`!!document.querySelector('.run-failure-notice')`), true);
  window.webContents.send('studio:run-failure', { ...notice, failure: undefined });
  await until(`!document.querySelector('.run-failure-notice')`);
  window.webContents.send('studio:run-failure', { ...notice, failure: 'PRIVATE_PROVIDER_DETAIL' });
  await until(
    `document.querySelector('.run-failure-notice')?.textContent.includes('Провайдер не завершил')`,
  );
  assert.equal(
    await js(
      `document.querySelector('.run-failure-notice').textContent.includes('PRIVATE_PROVIDER_DETAIL')`,
    ),
    false,
  );
  await js(`document.querySelector('[aria-label="Скрыть ошибку агента"]').click()`);
  await until(`!document.querySelector('.run-failure-notice')`);
  console.log(
    'Endpoint Electron UI passed: create local connection, server discovery without auth, explicit model capabilities, delete cancel/confirm, persistence/reload, exact scoped model/effort selection. No model requests.',
  );
  clearTimeout(deadline);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server?.closeAllConnections();
  server?.close();
  if (root)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
