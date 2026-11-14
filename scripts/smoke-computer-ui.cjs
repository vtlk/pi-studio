const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root,
  win,
  permissionActions = 0,
  simulateDenied = false;
const deadline = setTimeout(() => fail(Error('Computer UI timed out')), 30000);
async function cleanup() {
  clearTimeout(deadline);
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
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-computer-ui-')));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  for (const path of [studio, userData, join(studio, '.pistudio')]) mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents: [
          {
            id: 'computer-ui',
            name: 'QA Agent',
            enabled: true,
            skills: [],
            mcps: [],
            plugins: [],
            instructions: [],
          },
        ],
      },
    }),
  );
  const denied = {
    version: '0.49.11',
    phase: 'permissions_required',
    permissions: { accessibility: false, screenRecording: false },
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : name === 'studio:computer-state'
            ? (...args) => (simulateDenied ? denied : action(...args))
            : name === 'studio:computer-permissions' || name === 'studio:computer-settings'
              ? () => {
                  permissionActions++;
                  return denied;
                }
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
  const row = `Array.from(document.querySelectorAll('[data-builtin-mcp]')).find(e=>e.textContent.includes('Pi Studio · Компьютер'))`;
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
      await click('Pi Studio · Компьютер');
    await until(`(${row}).innerText.includes('Универсальный доступ:')`);
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const actual = await js('window.studio.getComputerState()');
  assert.notEqual(actual.phase, 'unavailable', 'The actual SDK must load through compiled main.');
  assert.ok(actual.permissions);
  await click('Агенты');
  await click('MCP');
  await checkRow();
  await js(`document.querySelector('[data-system-role="assistant"] button').click()`);
  await checkRow();
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('MCP-серверы');
  await checkRow();
  assert.equal(permissionActions, 0, 'Opening/listing/probing must never request permissions.');
  simulateDenied = true;
  await click('Проверить разрешения');
  await until(`(${row}).innerText.includes('Универсальный доступ: не разрешён')`);
  await click('Разрешить доступ');
  await until(`(${row}).innerText.includes('После изменения разрешений')`);
  assert.equal(
    permissionActions,
    1,
    'The explicit button invokes the permission entry point once (OS handler intercepted).',
  );
  assert.deepEqual((await js('window.studio.loadStudio()')).sections.agents[0].mcps, []);
  assert.equal(win.isVisible(), false);
  assert.equal(win.webContents.isOffscreen(), true);
  await writeFile('artifacts/computer-permissions-ui.png', (await win.capturePage()).toPNG());
  await writeFile(
    process.env.PI_STUDIO_QA_PROOF || 'artifacts/computer-ui-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        compiledMain: true,
        actualSdkStatus: true,
        ordinaryAgent: true,
        setupAssistant: true,
        settingsCatalog: true,
        rightLock: true,
        noDisableDelete: true,
        automaticPermissionPrompts: 0,
        deniedUiFixture: true,
        explicitPermissionButton: true,
        actualOsPermissionPromptTested: false,
        offscreen: true,
        separateUserData: true,
        packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Computer UI passed: actual SDK status; shared pinned rows; denied-state UI fixture; no OS permission prompts or visible windows.',
  );
  await cleanup();
  setTimeout(() => { console.error('Graceful Computer runtime quit timed out'); app.exit(1); }, 10000).unref();
  app.quit();
})().catch(fail);
