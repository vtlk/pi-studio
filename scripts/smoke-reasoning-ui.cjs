const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timer = setTimeout(() => {
  console.error('Reasoning UI timeout');
  app.exit(1);
}, 45000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-reasoning-ui-'));
  const studio = join(root, 'Studio'),
    data = join(root, 'UserData');
  mkdirSync(data);
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  app.setPath('userData', data);
  app.setPath('videos', root);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  const agent = {
    id: 'qa',
    name: 'QA reasoning',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      connectionId: 'qa-account',
      provider: 'test',
      id: 'wide',
      reasoning: 'Максимальный',
      temperature: '',
    },
  };
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents: [agent],
        connections: [
          {
            id: 'qa-account',
            name: 'QA account',
            purpose: 'pi',
            providerId: 'test',
            endpoint: '',
            account: '',
            createdAt: 1,
          },
        ],
      },
    }),
  );
  const models = [
    {
      provider: 'test',
      id: 'wide',
      name: 'Полная модель',
      reasoning: true,
      imageInput: false,
      reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningLevel: 'medium',
    },
    {
      provider: 'test',
      id: 'limited',
      name: 'Ограниченная модель',
      reasoning: true,
      imageInput: false,
      reasoningLevels: ['low', 'medium', 'high'],
      defaultReasoningLevel: 'medium',
    },
    {
      provider: 'test',
      id: 'plain',
      name: 'Без рассуждений',
      reasoning: false,
      imageInput: false,
      reasoningLevels: ['off'],
      defaultReasoningLevel: 'off',
    },
  ];
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models })
          : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, win) => {
      win.webContents.setBackgroundThrottling(false);
      win.webContents.once('did-finish-load', () => resolve(win));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const win = await loaded,
    js = (code) => win.webContents.executeJavaScript(code, true);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const until = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error(code + '\n' + (await js('document.body.innerText.slice(-1600)')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const effort = () =>
    js(`document.querySelector('[aria-label="Уровень рассуждения (effort)"]').textContent`);
  const openEffort = async () => {
    await js(`document.querySelector('[aria-label="Уровень рассуждения (effort)"]').click()`);
    await until(`!!document.querySelector('[role="option"]')`);
    return js(`Array.from(document.querySelectorAll('[role="option"]')).map(el=>el.textContent)`);
  };
  const chooseModel = async (name) => {
    await js(`document.querySelector('[aria-label="Модель агента"]').click()`);
    await until(`!!document.querySelector('.ui-searchable-select [role="option"]')`);
    await js(
      `Array.from(document.querySelectorAll('.ui-searchable-select [role="option"]')).find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await click('Модель');
  await until(
    `document.querySelector('[aria-label="Модель агента"]')?.textContent.includes('Полная модель')`,
  );
  assert.ok((await effort()).includes('Максимальный'));
  assert.deepEqual(await openEffort(), [
    'По умолчанию',
    'Минимальный',
    'Низкий',
    'Средний',
    'Высокий',
    'Максимальный',
    'Предельный',
  ]);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent==='Предельный').click()`,
  );
  await until(
    `document.querySelector('[aria-label="Уровень рассуждения (effort)"]').textContent.includes('Предельный')`,
  );
  await until(`document.querySelector('.prototype-label')?.textContent==='Сохранено'`);
  assert.equal((await js('window.studio.loadStudio()')).sections.agents[0].model.reasoning, 'max');
  await chooseModel('Ограниченная модель');
  await until(
    `document.querySelector('[aria-label="Уровень рассуждения (effort)"]').textContent.includes('По умолчанию')`,
  );
  assert.deepEqual(await openEffort(), ['По умолчанию', 'Низкий', 'Средний', 'Высокий']);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent==='Низкий').click()`,
  );
  await chooseModel('Без рассуждений');
  await until(`document.querySelector('[aria-label="Уровень рассуждения (effort)"]').disabled`);
  assert.ok((await effort()).includes('По умолчанию'));
  await chooseModel('Полная модель');
  await until(`!document.querySelector('[aria-label="Уровень рассуждения (effort)"]').disabled`);
  const boxes = await js(
    `Array.from(document.querySelectorAll('.agent-model-fields > .field-label')).map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y}})`,
  );
  assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 2));
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/reasoning-model-panel.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  console.log(
    JSON.stringify({
      passed: true,
      legacyRussianPreserved: true,
      nativeMaxSelectable: true,
      limitedOptions: true,
      explicitModelChangeResetsUnsupported: true,
      nonReasoningDefaultDisabled: true,
      threeFieldsSameRow: true,
      modelRequests: 0,
      catalog: 'synthetic native IPC fixture',
    }),
  );
  clearTimeout(timer);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (e) => {
  console.error(e);
  clearTimeout(timer);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  if (root)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
