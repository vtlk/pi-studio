const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-builtin-ui-')));
  try {
    for (const name of ['UserData', 'Videos']) await mkdir(join(root, name));
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      const timer = setTimeout(() => child.kill('SIGTERM'), 65000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(Error(output));
        else {
          console.log(output);
          resolve();
        }
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function child() {
  const { app, ipcMain, BrowserWindow, shell } = require('electron');
  const root = process.argv[3];
  assert.ok(root.includes('pistudio-builtin-ui-'));
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  app.getPreferredSystemLanguages = () => ['ru-RU'];
  let launches = 0,
    external = 0;
  shell.openExternal = async () => {
    external++;
    throw Error('External browser forbidden in QA');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, fn) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : name === 'studio:setup-assistant'
          ? () => {
              launches++;
              throw Error('Unexpected Pi launch');
            }
          : fn,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => done(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch(async (error) => {
      throw Error(
        code.slice(0, 250) +
          '\n' +
          (await window.webContents.executeJavaScript('document.body.innerText.slice(-2000)')) +
          '\n' +
          error.message,
      );
    });
  const until = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await js(code)) return;
      await new Promise((done) => setTimeout(done, 60));
    }
    throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText.slice(-1800)')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const saved = () =>
    until(
      `!!document.querySelector('[data-save-state="idle"]') && !document.querySelector('.storage-error')`,
    );
  const configure =
    'Выберите подключение, модель и уровень рассуждения агента в настройках → Подключения.';
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  await until(`!!document.querySelector('[data-system-role="assistant"]')`);
  await click('MCP');
  await until(`document.querySelectorAll('[data-builtin-mcp]').length===5`);
  assert.equal(
    await js(`document.querySelectorAll('[data-builtin-mcp] .ui-list-row-lock').length`),
    5,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('[data-builtin-mcp] [role="switch"], [data-builtin-mcp] .hover-delete').length`,
    ),
    0,
  );
  const state = await js('window.studio.loadStudio()');
  assert.equal(state.sections.systemAgents[0].mcps.length, 5);
  await js(`document.querySelector('.agent-helper-launch').click()`);
  await until(
    `document.querySelector('[role="alertdialog"]')?.innerText.includes(${JSON.stringify(configure)})`,
  );
  assert.equal(launches, 0);
  await click('Перейти');
  await until(
    `Array.from(document.querySelectorAll('.settings-layout .section-menu button')).some(b=>b.textContent.trim()==='Подключения' && b.getAttribute('aria-current')==='true')`,
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.settings-layout .section-menu button')).find(b=>b.textContent.trim()==='Подключения')?.getAttribute('aria-current')`,
    ),
    'true',
  );
  await click('Помощник подключения');
  await click('Открыть помощника в Pi');
  await until(
    `document.querySelector('[role="alertdialog"]')?.innerText.includes(${JSON.stringify(configure)})`,
  );
  await click('Отмена');
  assert.equal(launches, 0);
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Создать команду"]').click()`);
  await until(`!!document.querySelector('[aria-label="Название команды"]')`);
  await js(
    `(()=>{const input=document.querySelector('[aria-label="Название команды"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'QA team');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click('Создать');
  await until(`!!document.querySelector('.agent-team-add')`);
  await js(`document.querySelector('.agent-team-add').click()`);
  await until(`document.querySelectorAll('.agent-list-entry:not([data-system-role])').length===1`);
  await saved();
  const ordinary = (await js('window.studio.loadStudio()')).sections.agents[0];
  assert.deepEqual(ordinary.mcps, ['pistudio-project']);
  await click('MCP');
  await until(`document.querySelectorAll('[data-builtin-mcp]').length===1`);
  assert.equal(
    await js(`document.querySelectorAll('[data-builtin-mcp] .ui-list-row-lock').length`),
    1,
  );
  await js(`document.querySelector('[aria-label="Добавить MCP"]').click()`);
  await until(`Array.from(document.querySelectorAll('.dialog .resource-row')).length===4`);
  await js(
    `Array.from(document.querySelectorAll('.dialog .resource-row')).find(r=>r.innerText.includes('Pi Studio · Браузер')).querySelector('button').click()`,
  );
  await click('Готово');
  await until(`document.querySelectorAll('[data-builtin-mcp]').length===2`);
  const browser = `Array.from(document.querySelectorAll('[data-builtin-mcp]')).find(r=>r.innerText.includes('Pi Studio · Браузер'))`;
  assert.equal(await js(`${browser}.querySelectorAll('.ui-list-row-lock').length`), 0);
  assert.equal(
    await js(`${browser}.querySelector('[role="switch"]').getAttribute('aria-checked')`),
    'true',
  );
  await js(`${browser}.querySelector('[role="switch"]').click()`);
  await saved();
  const final = await js('window.studio.loadStudio()');
  assert.equal(final.sections.agents[0].capabilitySettings['mcps:pistudio-browser'].enabled, false);
  await saved();
  assert.equal(external, 0);
  const proof = {
    checkedAt: new Date().toISOString(),
    nativeMainPreloadRenderer: true,
    freshAssistantPinnedMcps: 5,
    freshOrdinaryOnlyProject: true,
    optionalBrowserHasSwitchAndNoLock: true,
    savedDisableVerified: true,
    missingModelModalFromBothEntryPoints: true,
    goOpensSettingsConnections: true,
    piLaunches: launches,
    externalBrowserLaunches: external,
    installedAppOrUserDataChanged: false,
  };
  await writeFile(
    'artifacts/builtin-assignments-ui-proof.json',
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
  for (const owned of BrowserWindow.getAllWindows()) owned.destroy();
  app.exit(0);
}
if (process.argv.includes('--child'))
  child().catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
else
  parent().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
