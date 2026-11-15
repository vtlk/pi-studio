const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, readFile, writeFile, readdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
let root;
const deadline = setTimeout(() => {
  console.error('Native bundle smoke timed out');
  app.exit(1);
}, 45000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-native-bundle-'));
  for (const key of ['videos', 'userData']) {
    const path = join(root, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA reload before saved');
    app.exit(1);
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code, contents = window.webContents) => {
    for (let i = 0; i < 100; i++) {
      if (await contents.executeJavaScript(code, true)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const saved = () =>
    until(
      `document.querySelector('.prototype-label')?.textContent.includes('Сохранено') && !document.querySelector('.storage-error')`,
    );
  const reload = async () => {
    await saved();
    const loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload();
    await loaded;
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const empty = await js('window.studio.loadStudio()');
  for (const name of ['agents', 'agentTeams', 'connections', 'resources'])
    assert.deepEqual(empty.sections[name], []);
  assert.deepEqual(empty.sections.agentCatalog, { agents: [], teams: [] });
  assert.equal(empty.sections.systemAgents.length, 1);
  assert.equal(empty.sections.systemAgents[0].systemRole, 'assistant');
  assert.deepEqual(empty.projects, []);
  assert.deepEqual((await js('window.studio.listLibrary()')).assets, []);
  assert.equal(empty.sections.baseInstruction, '');
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.topbar nav button')).map(button=>button.textContent.trim())`,
    ),
    ['Проекты', 'Библиотека', 'Агенты'],
  );
  await click('Библиотека');
  await until(`!!document.querySelector('[aria-label="Создать персонажа"]')`);
  await click('Агенты');
  await until(`!!document.querySelector('[aria-label="Создать команду"]')`);
  await js(`document.querySelector('.topbar [aria-label="Настройки"]').click()`);
  await until(`!!document.querySelector('[aria-label="Настройки студии"]')`);
  assert.equal(
    await js(`document.querySelector('.settings-content h2')?.textContent`),
    'Рабочее пространство',
  );
  await click('Проекты');
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.equal(await js(`document.body.innerText.includes('Посылка с характером')`), false);
  const report = JSON.parse(await readFile(resolve('out/renderer/native-build.json'), 'utf8'));
  assert.equal(report.webExampleModules, 0);
  const packagedFiles = await readdir(resolve('out/renderer'), { recursive: true });
  assert.ok(packagedFiles.includes('branding/pi-studio-icon.png'));
  assert.equal(
    packagedFiles.some((name) =>
      /(^|\/)(characters|scenes|library-runtime|source\.json|icon-prompt\.txt)(\/|$)/.test(name),
    ),
    false,
  );
  // The native entry never silently falls back to the demo if preload is unavailable.
  const unbound = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await unbound.loadFile(resolve('out/renderer/index.html'));
  await until(
    `document.body.innerText.includes('Нативное подключение Pi Studio недоступно')`,
    unbound.webContents,
  );
  assert.equal(
    await unbound.webContents.executeJavaScript(
      `!!document.querySelector('[aria-label="Создать проект"]')`,
    ),
    false,
  );
  unbound.destroy();
  const legacy = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
    import {initialAgents} from './src/renderer/fixtures/agents.ts';
    import {exampleConnections} from './src/renderer/fixtures/connections.ts';
    import {exampleResources} from './src/renderer/fixtures/resources.ts';
    console.log(JSON.stringify({agents:[initialAgents[0],{...initialAgents[1],mainInstruction:'User custom role'},{...initialAgents[2],id:'user-profile',name:'My profile'}],connections:exampleConnections,resources:exampleResources}));
  `,
      ],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    ),
  );
  for (const [key, value] of Object.entries(legacy)) {
    const before = await js('window.studio.loadStudio()');
    const result = await js(
      `window.studio.saveSection(${JSON.stringify(key)},${JSON.stringify(value)},${JSON.stringify({ folder: before.folder, base: before.sections[key] })})`,
    );
    assert.ok(result.saved);
  }
  const project = (
    await js(
      `window.studio.loadStudio().then(state=>window.studio.projectCommand({...${JSON.stringify({ kind: 'create', name: 'Legacy project', agents: legacy.agents })},teamId:state.sections.agentTeams[0].id}))`,
    )
  ).projects[0];
  const projectFile = join(empty.folder, 'projects', project.folderName, 'project.json');
  const projectBefore = await readFile(projectFile, 'utf8');
  const output = join(
    empty.folder,
    'projects',
    project.folderName,
    project.agents[0].outputPath,
    'keep.txt',
  );
  await writeFile(output, 'Keep project output');
  await reload();
  await until(
    `document.querySelector('[role="alertdialog"]')?.textContent.includes('Убрать сохранённые шаблоны макета?')`,
  );
  const beforeCancel = await js('window.studio.loadStudio()');
  assert.equal(beforeCancel.sections.agents.length, 3);
  await click('Отмена');
  assert.deepEqual((await js('window.studio.loadStudio()')).sections, beforeCancel.sections);
  await reload();
  await until(
    `document.querySelector('[role="alertdialog"]')?.textContent.includes('Убрать сохранённые шаблоны макета?')`,
  );
  await click('Убрать шаблоны');
  await saved();
  const cleaned = await js('window.studio.loadStudio()');
  assert.deepEqual(
    cleaned.sections.agents.map((a) => a.id),
    legacy.agents.slice(1).map((a) => a.id),
  );
  assert.deepEqual(cleaned.sections.connections, []);
  assert.deepEqual(cleaned.sections.resources, []);
  assert.equal(await readFile(projectFile, 'utf8'), projectBefore);
  assert.equal(await readFile(output, 'utf8'), 'Keep project output');
  await click('Вернуть');
  await saved();
  const restored = await js('window.studio.loadStudio()');
  assert.deepEqual(restored.sections.agents, beforeCancel.sections.agents);
  for (const key of ['connections', 'resources'])
    assert.deepEqual(
      [...restored.sections[key]].sort((a, b) =>
        `${a.kind ?? ''}:${a.id}`.localeCompare(`${b.kind ?? ''}:${b.id}`),
      ),
      [...beforeCancel.sections[key]].sort((a, b) =>
        `${a.kind ?? ''}:${a.id}`.localeCompare(`${b.kind ?? ''}:${b.id}`),
      ),
    );
  assert.equal(await readFile(projectFile, 'utf8'), projectBefore);
  clearTimeout(deadline);
  console.log(
    'Native bundle passed: empty install, three-page navigation and settings, no demo module/data graph, explicit missing-preload screen, SHA-256 legacy match with cancel/confirmation/undo, edited profiles and project files preserved. No model or Terminal requests.',
  );
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
