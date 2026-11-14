const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root,
  win,
  network = 0;
const timeout = setTimeout(() => fail(Error('Browser UI timed out')), 30000);
async function cleanup() {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-browser-ui-')));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  for (const path of [studio, userData, join(studio, '.pistudio')]) mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const agent = {
    id: 'browser-ui-agent',
    name: 'QA Agent',
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
    instructions: [],
  };
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { agents: [agent] } }),
  );
  global.fetch = async () => {
    network++;
    throw Error('Browser UI must not install/start components automatically');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  win = await loaded;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((done) => setTimeout(done, 40));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const row = `Array.from(document.querySelectorAll('[data-builtin-mcp]')).find(e=>e.textContent.includes('Pi Studio · Браузер'))`;
  const checkRow = async () => {
    await until(`!!(${row})`);
    assert.equal(await js(`(${row}).querySelectorAll('[role="switch"],.hover-delete').length`), 0);
    assert.equal(
      await js(`!!(${row}).querySelector('.ui-list-row-toggle .ui-list-row-lock')`),
      true,
    );
    if (
      await js(
        `(${row}).querySelector('.disclosure-trigger').getAttribute('aria-expanded')==='false'`,
      )
    )
      await click('Pi Studio · Браузер');
    await until(`(${row}).innerText.includes('Компоненты ещё не установлены.')`);
    assert.equal(
      await js(`(${row}).querySelectorAll('button').length`),
      2,
      'Disclosure and explicit installation only.',
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await click('MCP');
  await checkRow();
  await js(`document.querySelector('[data-system-role="assistant"] button').click()`);
  await checkRow();
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('MCP-серверы');
  await checkRow();
  assert.equal(network, 0);
  const persisted = await js('window.studio.loadStudio()');
  assert.deepEqual(
    persisted.sections.agents[0].mcps,
    [],
    'Mandatory MCP is not a detachable profile assignment.',
  );
  assert.equal(win.isVisible(), false);
  assert.equal(win.webContents.isOffscreen(), true);
  await writeFile('artifacts/browser-catalog-ui.png', (await win.capturePage()).toPNG());
  await writeFile(
    process.env.PI_STUDIO_QA_PROOF || 'artifacts/browser-ui-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        ordinaryAgent: true,
        setupAssistant: true,
        settingsCatalog: true,
        sharedDisclosure: true,
        rightLock: true,
        noDisableDelete: true,
        explicitInstallOnly: true,
        automaticNetworkRequests: network,
        offscreen: true,
        separateUserData: true,
        packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Browser UI passed: locked shared row in agents/helper/catalog, explicit install, no automatic network or visible window.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
