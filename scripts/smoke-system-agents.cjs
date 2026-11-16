const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('System agents smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-systems-desktop-'));
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
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) =>
      window.webContents.executeJavaScript(code, true).catch((error) => {
        console.error('Failed system expression', code.slice(0, 180));
        throw error;
      });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(await js('document.body.innerText.slice(-1500)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const field = async (label, value) =>
    js(
      `(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]') ?? Array.from(document.querySelectorAll('label')).find(element=>element.textContent.trim().startsWith(${JSON.stringify(label)}))?.control;Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const initial = await js('window.studio.loadStudio()');
  assert.deepEqual(initial.sections.agents, []);
  assert.deepEqual(
    initial.sections.systemAgents.map((agent) => agent.systemRole),
    ['assistant'],
  );
  await click('Агенты');
  await until(`document.querySelectorAll('[data-system-role]').length===1`);
  assert.equal(await js(`document.querySelectorAll('[data-system-role] .hover-delete').length`), 0);
  const ordered = () =>
    js(
      `(()=>{const plus=document.querySelector('[aria-label="Добавить агента"]'),system=document.querySelector('[data-system-role]');return !!(plus.compareDocumentPosition(system)&Node.DOCUMENT_POSITION_FOLLOWING) && Array.from(document.querySelectorAll('.agent-list-entry:not([data-system-role])')).every(row=>!!(row.compareDocumentPosition(plus)&Node.DOCUMENT_POSITION_FOLLOWING));})()`,
    );
  assert.equal(await ordered(), true);
  await field('Название агента', 'QA setup helper');
  await field('Основной промпт агента', 'QA current system role');
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  let state = await js('window.studio.loadStudio()');
  assert.equal(state.sections.systemAgents[0].name, 'QA setup helper');
  assert.equal(state.sections.systemAgents[0].mainInstruction, 'QA current system role');
  assert.deepEqual(state.sections.agents, []);
  await click('MCP');
  await until(`!!document.querySelector('[data-builtin-mcp]')`);
  assert.equal(
    await js(
      `document.querySelectorAll('[data-builtin-mcp] [role="switch"], [data-builtin-mcp] .hover-delete').length`,
    ),
    0,
  );
  await click('Pi Studio · Ресурсы и агенты');
  assert.equal(
    await js(
      `document.querySelector('[data-builtin-mcp]').innerText.includes('Отключение и удаление недоступны')`,
    ),
    true,
  );
  const rejected = await js(
    `window.studio.saveSection('systemAgents',${JSON.stringify(state.sections.systemAgents.slice(1))},${JSON.stringify({ folder: state.folder, base: state.sections.systemAgents })}).then(()=>false,()=>true)`,
  );
  assert.equal(rejected, true);
  assert.equal((await js('window.studio.loadStudio()')).sections.systemAgents.length, 1);
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Новый агент'`);
  await field('Название агента', 'First project role');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Новый агент'`);
  await field('Название агента', 'Second project role');
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  state = await js('window.studio.loadStudio()');
  assert.deepEqual(
    state.sections.agents.map((agent) => agent.name),
    ['First project role', 'Second project role'],
  );
  assert.equal(await ordered(), true);
  const created = await js(
    `window.studio.projectCommand({kind:'create',name:'System exclusion',agents:${JSON.stringify(state.sections.systemAgents)}})`,
  );
  assert.deepEqual(
    created.projects[0].agents.map((agent) => agent.profile.id),
    state.sections.agents.map((agent) => agent.id),
  );
  assert.equal(created.projects[0].agents.length, 2);
  await js(`document.querySelector('[data-system-role="assistant"] button').click()`);
  await click('Инструкции');
  await until(
    `document.querySelector('[aria-label="Название агента"]')?.value==='QA setup helper'`,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await click('Итоговое задание');
  await until(
    `document.querySelector('textarea[aria-label="Итоговые инструкции"]')?.value.includes('Pi Studio · Ресурсы и агенты (встроенный, закреплён)')`,
  );
  await click('Закрыть');
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(
    resolve('artifacts/system-agents-smoke.png'),
    (await window.capturePage()).toPNG(),
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const reopened = await js('window.studio.loadStudio()');
  assert.deepEqual(reopened.sections.systemAgents, state.sections.systemAgents);
  assert.deepEqual(reopened.sections.agents, state.sections.agents);
  const nextTemplates = [
    state.sections.agents[1],
    { ...state.sections.agents[0], id: 'qa-new-project-role', name: 'Third project role' },
  ];
  await js(
    `window.studio.saveSection('agents',${JSON.stringify(nextTemplates)},${JSON.stringify({ folder: state.folder, base: state.sections.agents })})`,
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('System exclusion')).click()`,
  );
  await until(`!!document.querySelector('.project-header')`);
  const beforeSync = await js('window.studio.loadStudio()');
  await click('Перечитать агентов');
  await click('Перечитать');
  await until(`document.querySelector('.agent-diff')?.textContent.includes('Уберутся из проекта')`);
  assert.ok(
    (await js(`document.querySelector('.agent-diff').textContent`)).includes('First project role'),
  );
  assert.ok(
    (await js(`document.querySelector('.agent-diff').textContent`)).includes('Third project role'),
  );
  await click('Отмена');
  assert.deepEqual(
    (await js('window.studio.loadStudio()')).projects[0].agents,
    beforeSync.projects[0].agents,
  );
  await click('Перечитать агентов');
  await click('Перечитать');
  await click('Применить');
  await until(`document.body.innerText.includes('Список агентов синхронизирован')`);
  const synced = await js('window.studio.loadStudio()');
  assert.deepEqual(
    synced.projects[0].agents.map((agent) => agent.profile.id),
    nextTemplates.map((agent) => agent.id),
  );
  assert.equal(synced.projects[0].archivedAgents[0].agent.profile.id, state.sections.agents[0].id);
  await click('Вернуть удалённых');
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-item').length===3`);
  await click('Перечитать агентов');
  await click('Перечитать');
  await click('Применить');
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-item').length===2`);
  assert.deepEqual(
    (await js('window.studio.loadStudio()')).projects[0].agents.map((agent) => agent.profile.id),
    nextTemplates.map((agent) => agent.id),
  );
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('Помощник подключения');
  await until(
    `document.querySelector('[aria-label="Модель помощника подключения"]')?.textContent.includes('не выбрано')`,
  );
  await click('Настройки модели помощника');
  await until(`!!document.querySelector('[aria-label="Подключение модели"]')`);
  assert.equal(
    await js(`document.querySelector('[aria-label="Название агента"]').value`),
    'QA setup helper',
  );
  const assistantState = await js('window.studio.loadStudio()');
  const configured = assistantState.sections.systemAgents.map((agent) =>
    agent.systemRole === 'assistant'
      ? {
          ...agent,
          model: {
            connectionId: 'qa-helper',
            provider: 'openai-codex',
            id: 'gpt-5.6-luna',
            reasoning: 'Средний',
            temperature: '',
          },
        }
      : agent,
  );
  await js(
    `window.studio.saveSection('connections',${JSON.stringify([{ id: 'qa-helper', name: 'QA helper subscription', purpose: 'codex', providerId: 'openai-codex', endpoint: '', account: '', createdAt: 1 }])},${JSON.stringify({ folder: assistantState.folder, base: assistantState.sections.connections })})`,
  );
  await js(
    `window.studio.saveSection('systemAgents',${JSON.stringify(configured)},${JSON.stringify({ folder: assistantState.folder, base: assistantState.sections.systemAgents })})`,
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Настройки"]')`);
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('Помощник подключения');
  const helperSummary = await js(
    `document.querySelector('[aria-label="Модель помощника подключения"]').textContent`,
  );
  for (const expected of ['QA helper subscription', 'gpt-5.6-luna', 'Средний'])
    assert.ok(helperSummary.includes(expected), helperSummary);
  await click('Настройки модели помощника');
  await until(
    `document.querySelector('[aria-label="Подключение модели"]')?.textContent.includes('QA helper subscription')`,
  );
  assert.equal(
    await js(`document.querySelector('[aria-label="Название агента"]').value`),
    'QA setup helper',
  );
  console.log(
    'System agents Electron passed: fixed service group/editor, pinned MCP/deletion guards, appended project profiles, snapshots exclude systems; confirmed project synchronization adds/removes IDs, cancellation preserves data, undo and repeated synchronization work.',
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
