const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Connection UI smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-connections-'));
  for (const name of ['Videos', 'UserData']) mkdirSync(join(temporary, name));
  app.setPath('videos', join(temporary, 'Videos'));
  app.setPath('userData', join(temporary, 'UserData'));
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('../out/main/index.cjs');
  const window = await loaded;
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(await js('document.body.innerText.slice(-2000)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const initial = await js('window.studio.loadStudio()');
  const account = {
    id: 'qa-codex',
    name: 'QA Codex',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  await js(
    `window.studio.saveSection('connections',${JSON.stringify([account])},${JSON.stringify({ folder: initial.folder, base: initial.sections.connections })})`,
  );
  const reload = async () => {
    window.webContents.reload();
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  };
  await reload();
  const expected = await js(`window.studio.getProviderStatus('openai-codex')`);
  const settings = async () => {
    await js(`document.querySelector('[aria-label="Настройки"]').click()`);
    await click('Подключения');
  };
  await settings();
  await until(
    `document.querySelector('.resource-row small')?.textContent===${JSON.stringify(expected.status === 'ready' ? 'Подключено' : expected.status === 'not_ready' ? 'Pi: требуется вход' : 'Pi: ошибка авторизации')}`,
  );
  await click('Настроить');
  if (expected.status === 'ready')
    await until(
      `Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).some(element=>element.textContent.includes('Подключено через Pi'))`,
    );
  await click('Отмена');
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await click('Модель');
  assert.equal(await js(`document.querySelector('[aria-label="Модель агента"]').disabled`), true);
  assert.ok(
    (await js(`document.querySelector('[aria-label="Модель агента"]').textContent`)).includes(
      'Сначала подключение',
    ),
  );
  await js(`document.querySelector('[aria-label="Подключение модели"]').click()`);
  await until(`!!document.querySelector('[role="option"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(option=>option.textContent.includes('QA Codex')).click()`,
  );
  await until(`!document.querySelector('[aria-label="Модель агента"]').disabled`);
  const row = await js(
    `['Подключение модели','Модель агента','Уровень рассуждения (effort)'].map(label=>{const r=document.querySelector('[aria-label="'+label+'"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})`,
  );
  assert.ok(row.every((item) => Math.abs(item.y - row[0].y) < 1));
  assert.ok(row[0].x < row[1].x && row[1].x < row[2].x);
  await js(`document.querySelector('[aria-label="Модель агента"]').click()`);
  await until(`document.querySelectorAll('[role="option"]').length>1`);
  await js(`document.querySelectorAll('[role="option"]')[1].click()`);
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  const state = await js('window.studio.loadStudio()');
  assert.equal(state.sections.agents[0].model.connectionId, account.id);
  assert.ok(state.sections.agents[0].model.id);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/agent-model-row.png'), (await window.capturePage()).toPNG());
  window.setSize(1080, 900);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const small = await js(
    `['Подключение модели','Модель агента','Уровень рассуждения (effort)'].map(label=>{const r=document.querySelector('[aria-label="'+label+'"]').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right};})`,
  );
  assert.ok(small.every((item) => Math.abs(item.y - small[0].y) < 1));
  assert.ok(small[2].right <= 1080);
  await writeFile(
    resolve('artifacts/agent-model-row-small.png'),
    (await window.capturePage()).toPNG(),
  );
  window.setSize(1512, 1000);
  await reload();
  await settings();
  await until(
    `document.querySelector('.resource-row small')?.textContent===${JSON.stringify(expected.status === 'ready' ? 'Подключено' : expected.status === 'not_ready' ? 'Pi: требуется вход' : 'Pi: ошибка авторизации')}`,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/connection-status-smoke.png'),
    (await window.capturePage()).toPNG(),
  );
  // Two accounts of the same provider must remain independent through the actual editor/IPC.
  await click('Проекты');
  const before = await js('window.studio.loadStudio()');
  const isolated = ['one', 'two'].map((id) => ({
    ...account,
    id: 'qa-isolated-' + id,
    name: 'QA isolated ' + id,
    purpose: 'pi',
    providerId: 'openai',
    authScope: 'connection',
  }));
  await js(
    `window.studio.saveSection('connections',${JSON.stringify([account, ...isolated])},${JSON.stringify({ folder: before.folder, base: before.sections.connections })})`,
  );
  await reload();
  await settings();
  const rowStatus = (name) =>
    `Array.from(document.querySelectorAll('.resource-row')).find(row=>row.querySelector('strong')?.textContent===${JSON.stringify(name)})?.querySelector('small')?.textContent`;
  const edit = async (name) => {
    await js(
      `Array.from(document.querySelectorAll('.resource-row')).find(row=>row.querySelector('strong')?.textContent===${JSON.stringify(name)}).querySelector('button').click()`,
    );
    await until(`!!document.querySelector('[role="dialog"]')`);
  };
  const typeAnswer = async (value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label="Ответ для входа Pi"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const keys = ['sk-ui-fixture-one-not-real', 'sk-ui-fixture-two-not-real'];
  for (let i = 0; i < isolated.length; i++) {
    await until(`${rowStatus(isolated[i].name)}==='Pi: требуется вход'`);
    await edit(isolated[i].name);
    await until(`!!document.querySelector('[aria-label="Способ входа Pi"]')`);
    await js(`document.querySelector('[aria-label="Способ входа Pi"]').click()`);
    await until(`!!document.querySelector('[role="option"][data-state]')`);
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.getAttribute('data-state')!=='checked').click()`,
    );
    await until(
      `Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='Войти через Pi'&&!el.disabled)`,
    );
    await click('Войти через Pi');
    await until(`!!document.querySelector('[aria-label="Ответ для входа Pi"]')`);
    assert.equal(
      await js(`document.querySelector('[aria-label="Ответ для входа Pi"]').type`),
      'password',
    );
    await typeAnswer(keys[i]);
    await click('Продолжить вход');
    await until(
      `Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).some(el=>el.textContent.includes('Вход выполнен для выбранного подключения'))`,
    );
    assert.equal(await js(`!!document.querySelector('[aria-label="Ответ для входа Pi"]')`), false);
    await click('Отмена');
    await until(`${rowStatus(isolated[i].name)}==='Подключено'`);
    if (i === 0) assert.equal(await js(rowStatus(isolated[1].name)), 'Pi: требуется вход');
  }
  await reload();
  await settings();
  for (const profile of isolated) await until(`${rowStatus(profile.name)}==='Подключено'`);
  await edit(isolated[0].name);
  await click('Удалить сохранённый вход');
  await until(`document.querySelectorAll('[role="alertdialog"]').length===1`);
  await js(`document.querySelector('[role="alertdialog"]').querySelectorAll('button')[0].click()`);
  await until(`document.querySelectorAll('[role="dialog"]').length===1`);
  assert.equal(
    (
      await js(
        `window.studio.getConnectionStatus(${JSON.stringify({ folder: before.folder, connectionId: isolated[0].id })})`,
      )
    ).status,
    'ready',
  );
  await click('Удалить сохранённый вход');
  await until(`document.querySelectorAll('[role="alertdialog"]').length===1`);
  await js(
    `document.querySelector('[role="alertdialog"]').querySelector('.button.primary').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).some(el=>el.textContent==='Pi: требуется вход.')`,
  );
  await click('Отмена');
  assert.equal(await js(rowStatus(isolated[1].name)), 'Подключено');
  const raw = JSON.stringify(await js('window.studio.loadStudio()'));
  for (const key of keys) assert.equal(raw.includes(key), false);
  console.log(
    'Connection UI passed: legacy status/catalog, two isolated native API-key forms with masked input, independent statuses across reload, confirmed/cancelled logout, no keys in studio, three agent model fields in one row. No model requests.',
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
