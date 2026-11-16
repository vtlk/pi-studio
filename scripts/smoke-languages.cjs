const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, cp } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-languages-'));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    const phases = [];
    for (const phase of ['system-ru', 'fallback', 'saved']) {
      if (phase === 'fallback') await rm(join(root, 'UserData/language.json'), { force: true });
      await new Promise((done, fail) => {
        const child = spawn(require('electron'), [__filename, '--child', root, phase], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let log = '';
        child.stdout.on('data', (data) => (log += data));
        child.stderr.on('data', (data) => (log += data));
        const timer = setTimeout(() => child.kill('SIGTERM'), 85000);
        child.once('error', fail);
        child.once('close', (code) => {
          clearTimeout(timer);
          code === 0 ? done() : fail(Error(log));
        });
      });
      phases.push(JSON.parse(await readFile(join(root, phase + '.json'), 'utf8')));
    }
    await mkdir('artifacts', { recursive: true });
    for (const lang of ['en', 'ru'])
      await cp(join(root, lang + '.png'), 'artifacts/languages-' + lang + '.png');
    const proof = {
      checkedAt: new Date().toISOString(),
      nativeMainPreloadRenderer: true,
      phases,
      installedAppChanged: false,
      userDataChanged: false,
      osLanguageChanged: false,
      nativeWindowsAccepted: false,
    };
    await writeFile('artifacts/languages-native-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
async function child() {
  const { app, ipcMain, Menu } = require('electron');
  const root = process.argv[3],
    phase = process.argv[4];
  assert.ok(root.includes('pistudio-languages-'));
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  app.getPreferredSystemLanguages = () => (phase === 'system-ru' ? ['ru-KZ'] : ['de-DE', 'ru-RU']);
  let launches = 0;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : ['studio:launch-agent', 'studio:open-setup-assistant'].includes(channel)
          ? () => {
              launches++;
              throw Error('No launch in language QA');
            }
          : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => done(window)),
    ),
  );
  const timer = setTimeout(() => app.exit(1), 80000);
  try {
    require('./offscreen-main.cjs').loadOffscreenMain();
    const window = await loaded;
    const errors = [];
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') errors.push(details.message);
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 35));
      }
      throw Error(code + '\n' + (await js('document.body.innerText')));
    };
    await until(`!!document.querySelector('.language-select')`);
    const expected = phase === 'fallback' ? 'en' : 'ru';
    assert.equal(await js('document.documentElement.lang'), expected);
    assert.equal(
      (await js('window.studio.getLanguage()')).preference,
      phase === 'saved' ? 'ru' : 'system',
    );
    assert.equal(
      await js(
        `document.querySelector('.language-select').nextElementSibling.classList.contains('theme-toggle')`,
      ),
      true,
    );
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.language-select')).borderTopWidth`),
      '0px',
    );
    const check = async (language) => {
      const labels =
        language === 'ru' ? ['Проекты', 'Агенты', 'Настройки'] : ['Projects', 'Agents', 'Settings'];
      const expectedMenu = language === 'ru' ? 'Проверить обновления…' : 'Check for Updates…';
      await until(
        `document.documentElement.lang===${JSON.stringify(language)}&&document.querySelector('.settings-button').textContent.trim()===${JSON.stringify(labels[2])}`,
      );
      assert.equal(Menu.getApplicationMenu().getMenuItemById('check-updates').label, expectedMenu);
      assert.deepEqual(
        await js(
          `Array.from(document.querySelectorAll('.topbar nav button')).map(e=>e.textContent.trim())`,
        ),
        labels.slice(0, 2),
      );
    };
    await check(expected);
    if (phase === 'fallback') {
      await js(`document.querySelector('.settings-button').click()`);
      await until(`document.body.innerText.includes('Workspace')`);
      await writeFile(join(root, 'en.png'), (await window.webContents.capturePage()).toPNG());
      // A draft in a real controlled field survives a language switch; it must not remount or save.
      await js(
        `(()=>{const e=document.querySelector('input[placeholder="/Users/…/Pi Studio"]');window.languageQaInput=e;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'/draft/Русский project');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true,
      });
      await js(`document.querySelector('.language-select').focus()`);
      for (const type of ['keyDown', 'keyUp'])
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
        });
      await until(`document.querySelectorAll('[role="menuitemradio"]').length===2`);
      assert.deepEqual(
        await js(
          `Array.from(document.querySelectorAll('[role="menuitemradio"]')).map(e=>e.textContent.trim())`,
        ),
        ['EN', 'RU'],
      );
      await js(
        `Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(e=>e.textContent.trim()==='RU').click()`,
      );
      await check('ru');
      await until(`document.body.innerText.includes('Рабочее пространство')`);
      await until(
        `document.querySelector('[aria-label="Запуск агента"]').textContent.includes('Открыть macOS Terminal')`,
      );
      assert.equal(
        await js(
          `window.languageQaInput===document.querySelector('input[placeholder="/Users/…/Pi Studio"]')&&window.languageQaInput.value==='/draft/Русский project'`,
        ),
        true,
      );
      assert.deepEqual(JSON.parse(await readFile(join(root, 'UserData/language.json'), 'utf8')), {
        language: 'ru',
      });
      await writeFile(join(root, 'ru.png'), (await window.webContents.capturePage()).toPNG());
      await js(`document.querySelectorAll('.topbar nav button')[1].click()`);
      await until(`document.body.textContent.includes('Системные')`);
      // Invalid IPC cannot change persisted or active language.
      assert.equal(await js(`window.studio.setLanguage('fr').then(()=>false,()=>true)`), true);
      await check('ru');
    }
    assert.equal(launches, 0);
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, phase + '.json'),
      JSON.stringify({
        phase,
        initialLanguage: expected,
        explicitChoiceSurvivesRestart: phase === 'saved',
        launches,
        errors,
      }),
    );
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
