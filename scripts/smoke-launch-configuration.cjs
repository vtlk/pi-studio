const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, access } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Launch configuration smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-launch-config-'));
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
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      console.error(code);
      throw error;
    });
  const until = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(await js('document.body.innerText.slice(-1800)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const reload = async () => {
    window.webContents.reload();
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  let state = await js('window.studio.loadStudio()');
  const connection = {
    id: 'qa-codex',
    name: 'QA account',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  await js(
    `window.studio.saveSection('connections',${JSON.stringify([connection])},${JSON.stringify({ folder: state.folder, base: state.sections.connections })})`,
  );
  const model = {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-model',
    reasoning: 'Средний',
    temperature: '',
  };
  for (const field of ['connectionId', 'id', 'reasoning', 'valid', 'stale-snapshot']) {
    state = await js('window.studio.loadStudio()');
    const profiles = [
      {
        id: 'other-agent',
        name: 'Other agent',
        enabled: false,
        instructions: [],
        skills: [],
        mcps: [],
        plugins: [],
      },
      {
        id: 'target-agent',
        name: 'Requested scenario agent',
        enabled: true,
        instructions: [],
        skills: [],
        mcps: [],
        plugins: [],
        model:
          field === 'valid' ? model : { ...model, [field === 'stale-snapshot' ? 'id' : field]: '' },
      },
    ];
    await js(
      `window.studio.saveSection('agents',${JSON.stringify(profiles)},${JSON.stringify({ folder: state.folder, base: state.sections.agents })})`,
    );
    const project = (
      await js(
        `window.studio.projectCommand({kind:'create',name:${JSON.stringify('Guard ' + field)},agents:[]})`,
      )
    ).projects.find((project) => project.name === 'Guard ' + field);
    if (field === 'stale-snapshot')
      await js(
        `window.studio.saveSection('agents',${JSON.stringify([profiles[0], { ...profiles[1], model }])},${JSON.stringify({ folder: state.folder, base: profiles })})`,
      );
    await reload();
    await js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.startsWith(${JSON.stringify('Guard ' + field)})&&!button.getAttribute('aria-label')).click()`,
    );
    await until(`!!document.querySelector('.project-agent-toolbar')`);
    const before = await js(`window.studio.readProject(${JSON.stringify(project.id)})`);
    if (field === 'valid' || field === 'stale-snapshot') {
      await click('Запустить');
      await until(`!!document.querySelector('.agent-first-message')`);
      await click('Отмена');
    } else {
      await click('Запустить');
      await until(
        `document.querySelector('[role="dialog"]')?.textContent.includes('Сначала настройте подключение Агента в настройках агента')`,
      );
      assert.equal(await js(`document.querySelectorAll('.agent-first-message').length`), 0);
      await click('Отмена');
      assert.deepEqual(
        await js(`window.studio.readProject(${JSON.stringify(project.id)})`),
        before,
      );
      await js(
        `document.querySelector('[aria-label="Другие варианты запуска"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
      );
      await until(`!!document.querySelector('[role="menuitem"]')`);
      await js(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item=>item.textContent.trim()==='Запустить и продолжить').click()`,
      );
      await until(
        `document.querySelector('[role="dialog"]')?.textContent.includes('Сначала настройте подключение Агента в настройках агента')`,
      );
      await click('Перейти');
      await until(
        `document.querySelector('[aria-label="Название агента"]')?.value==='Requested scenario agent'&&!!document.querySelector('[aria-label="Модель агента"]')`,
      );
    }
    assert.deepEqual(await js(`window.studio.readProject(${JSON.stringify(project.id)})`), before);
    await assert.rejects(
      access(join(state.folder, 'projects', project.folderName, '.pistudio/context')),
    );
  }
  console.log(
    'Launch configuration Electron passed: missing connection/model/reasoning block both launch actions before input/session/context creation, cancellation preserves project/mode, Go selects the exact agent Model tab, configured launch opens only the first-message dialog.',
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
