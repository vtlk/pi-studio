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
      if (phase === 'system-ru') await writeFile(join(root, 'UserData/appearance.json'), '{}');
      else await rm(join(root, 'UserData/appearance.json'), { force: true });
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
    for (const lang of ['en', 'ru', 'plugins-en', 'mcp-en', 'mcp-ru'])
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
  const uiAudit = [];
  let browserLaunches = 0;
  let forbiddenActions = 0;
  const { shell } = require('electron');
  shell.openExternal = async () => {
    browserLaunches++;
    throw Error('External browser prohibited in localization QA');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      [
        'studio:resource-install',
        'studio:resource-login',
        'studio:provider-login',
        'studio:connection-login',
        'studio:codex-login',
        'studio:browser-install-visible',
        'studio:computer-permissions',
        'studio:computer-settings',
      ].includes(channel)
        ? () => {
            forbiddenActions++;
            throw Error('No installation, sign-in or OS changes in localization QA');
          }
        : channel === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : channel === 'studio:browser-state'
            ? () => ({ headlessInstalled: false, headedInstalled: false, headedSupported: false })
            : channel === 'studio:computer-state'
              ? () => ({
                  phase: 'permissions_required',
                  version: 'QA',
                  permissions: { accessibility: false, screenRecording: false },
                })
              : channel === 'studio:startup'
                ? () => ({ phase: 'ready', message: 'QA' })
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
    const js = (code) =>
      window.webContents.executeJavaScript(code, true).catch((error) => {
        console.error('Language QA expression:', code);
        throw error;
      });
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
    if (phase === 'system-ru') {
      await until(`!!document.querySelector('.theme-error')`);
      assert.match((await js('window.studio.getTheme()')).error, /Не удалось прочитать/);
      uiAudit.push('native startup diagnostics use the resolved language');
    }
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
      const clickText = (label) =>
        js(
          `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)}&&e.getClientRects().length).click()`,
        );
      const named = (label) =>
        js(
          `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
        );
      const openMenu = async (label) => {
        await js(
          `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').focus()`,
        );
        for (const type of ['keyDown', 'keyUp'])
          await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type,
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          });
      };
      const setLanguage = async (language) => {
        await js(`window.studio.setLanguage(${JSON.stringify(language)})`);
        await check(language);
      };
      const closeModal = async () => {
        await js(
          `Array.from(document.querySelectorAll('[role="dialog"] button')).filter(e=>e.getAttribute('aria-label')==='Close window'||e.getAttribute('aria-label')==='Закрыть окно').at(-1).click()`,
        );
      };
      await setLanguage('en');
      await until(`document.querySelector('.agent-list-name').textContent==='Setup assistant'`);
      await clickText('Plugins');
      await named('Add Plugins');
      await until(
        `document.querySelector('[role="dialog"]').textContent.includes('Shared catalog · Plugins')`,
      );
      await writeFile(
        join(root, 'plugins-en.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await js(`window.languageQaModal=document.querySelector('[role="dialog"]');void 0`);
      await setLanguage('ru');
      await until(
        `document.querySelector('[role="dialog"]').textContent.includes('Общий каталог · Плагины')`,
      );
      assert.equal(
        await js(`window.languageQaModal===document.querySelector('[role="dialog"]')`),
        true,
      );
      await setLanguage('en');
      await named('Add Pi package');
      await until(`document.querySelectorAll('[role="dialog"]').length===2`);
      assert.equal(
        await js(
          `/[А-Яа-яЁё]/.test(Array.from(document.querySelectorAll('[role="dialog"]')).at(-1).innerText)`,
        ),
        false,
      );
      uiAudit.push('plugin catalog and nested package modal; live RU/EN');
      await closeModal();
      await closeModal();
      await clickText('MCP');
      await until(
        `Array.from(document.querySelectorAll('.disclosure-heading')).some(e=>e.textContent.includes('Pi Studio · Browser'))`,
      );
      for (const name of ['Pi Studio · Browser', 'Pi Studio · Computer']) await clickText(name);
      await until(
        `Array.from(document.querySelectorAll('.disclosure-content [role="status"]')).some(e=>e.textContent.includes('Components are not installed yet.'))`,
      );
      await writeFile(join(root, 'mcp-en.png'), (await window.webContents.capturePage()).toPNG());
      await setLanguage('ru');
      await until(
        `Array.from(document.querySelectorAll('.disclosure-content [role="status"]')).some(e=>e.textContent.includes('Компоненты ещё не установлены.'))`,
      );
      await writeFile(join(root, 'mcp-ru.png'), (await window.webContents.capturePage()).toPNG());
      await setLanguage('en');
      assert.equal(
        await js(
          `Array.from(document.querySelectorAll('.resource-binding')).some(e=>/[А-Яа-яЁё]/.test(e.innerText))`,
        ),
        false,
      );
      uiAudit.push('all pinned MCP names, descriptions, loaded browser status and permissions');
      await named('Add MCP');
      await until(`document.querySelector('[role="dialog"]').innerText.includes('Pi Studio Team')`);
      assert.equal(
        await js(`/[А-Яа-яЁё]/.test(document.querySelector('[role="dialog"]').innerText)`),
        false,
      );
      await closeModal();
      uiAudit.push('built-in MCP picker');
      await clickText('Skills');
      await named('Add Skills');
      await openMenu('Add skill');
      await until(`document.querySelectorAll('[role="menuitem"]').length>0`);
      await js(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Create').click()`,
      );
      await until(`document.querySelectorAll('[role="dialog"]').length===2`);
      assert.equal(
        await js(
          `/[А-Яа-яЁё]/.test(Array.from(document.querySelectorAll('[role="dialog"]')).at(-1).innerText)`,
        ),
        false,
      );
      await closeModal();
      await closeModal();
      uiAudit.push('skill catalog and nested creation modal');
      await js(`document.querySelector('.settings-button').click()`);
      await clickText('MCP servers');
      await until(`document.querySelectorAll('.resource-row').length>=5`);
      assert.equal(
        await js(`/[А-Яа-яЁё]/.test(document.querySelector('.resource-catalog').innerText)`),
        false,
      );
      await js(
        `Array.from(document.querySelectorAll('.resource-row')).find(e=>e.textContent.includes('Pi Studio · Browser')).querySelector('button').click()`,
      );
      await until(
        `document.querySelector('[role="dialog"]').innerText.includes('Pi Studio · Browser')`,
      );
      await setLanguage('ru');
      await until(
        `document.querySelector('[role="dialog"]').innerText.includes('Pi Studio · Браузер')`,
      );
      await setLanguage('en');
      assert.equal(
        await js(`/[А-Яа-яЁё]/.test(document.querySelector('[role="dialog"]').innerText)`),
        false,
      );
      await closeModal();
      await js(
        `Array.from(document.querySelectorAll('.resource-row')).find(e=>e.textContent.includes('Pi Studio · Computer')).querySelector('button').click()`,
      );
      await until(
        `document.querySelector('[role="dialog"]').innerText.includes('Pi Studio · Computer')`,
      );
      assert.equal(
        await js(`/[А-Яа-яЁё]/.test(document.querySelector('[role="dialog"]').innerText)`),
        false,
      );
      await closeModal();
      uiAudit.push('settings catalog and browser/computer detail modals');
      await js(`document.querySelectorAll('.topbar nav button')[1].click()`);
      await named('Create team');
      await until(`!!document.querySelector('[aria-label="Team name"]')`);
      await js(
        `(()=>{const e=document.querySelector('[aria-label="Team name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'QA team');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await clickText('Create');
      await until(`!document.querySelector('[role="dialog"]')`);
      await openMenu('Actions for team “QA team”');
      await until(`document.querySelectorAll('[role="menuitem"]').length>0`);
      await js(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Delete team').click()`,
      );
      await until(`!!document.querySelector('[role="alertdialog"]')`);
      await setLanguage('ru');
      await until(
        `document.querySelector('[role="alertdialog"]').textContent.includes('Удалить команду «QA team»')`,
      );
      await setLanguage('en');
      await clickText('Delete');
      await until(`!!document.querySelector('.toast-action')`);
      await setLanguage('ru');
      await until(`document.querySelector('.toast-action').textContent.trim()==='Вернуть'`);
      assert.equal(
        await js(
          `document.querySelector('.toast').textContent.includes('Команда «QA team» удалена.')`,
        ),
        true,
      );
      await setLanguage('en');
      await until(`document.querySelector('.toast-action').textContent.trim()==='Undo'`);
      await js(`document.querySelector('.toast-action').click()`);
      await until(`!!document.querySelector('[aria-label="Actions for team “QA team”"]')`);
      uiAudit.push('live confirmation and Undo notice; stable team restoration');
      await setLanguage('ru');

      // Invalid IPC cannot change persisted or active language.
      assert.equal(await js(`window.studio.setLanguage('fr').then(()=>false,()=>true)`), true);
      await check('ru');
    }
    assert.equal(launches, 0);
    assert.equal(browserLaunches, 0);
    assert.equal(forbiddenActions, 0);
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, phase + '.json'),
      JSON.stringify({
        phase,
        initialLanguage: expected,
        explicitChoiceSurvivesRestart: phase === 'saved',
        launches,
        browserLaunches,
        forbiddenActions,
        uiAudit,
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
