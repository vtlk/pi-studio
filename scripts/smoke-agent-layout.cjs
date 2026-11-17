const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, readFile, writeFile, cp } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-agent-layout-'));
  try {
    for (const name of ['UserData', 'Videos']) await mkdir(join(root, name));
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
      });
      let log = '';
      child.stdout.on('data', (b) => {
        log += b;
      });
      child.stderr.on('data', (b) => {
        log += b;
      });
      const deadline = setTimeout(() => child.kill('SIGTERM'), 85000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(deadline);
        if (code) reject(Error(log));
        else resolve();
      });
    });
    const proof = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/agent-layout-proof.json', JSON.stringify(proof, null, 2) + '\n');
    await cp(join(root, 'team.png'), 'artifacts/agent-layout-team.png');
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function child() {
  const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
  const root = process.argv[3];
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [join(root, 'OtherStudio')] });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let failNext = false;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : channel === 'studio:save-section'
          ? async (...args) => {
              await pause(400);
              if (failNext) {
                failNext = false;
                throw Error('QA controlled save failure');
              }
              return action(...args);
            }
          : channel === 'studio:launch-agent' || channel === 'studio:open-setup-assistant'
            ? () => {
                throw Error('No model or Terminal launch in layout QA');
              }
            : action,
    );
  const deadline = setTimeout(() => {
    console.error('Layout QA timeout');
    app.exit(1);
  }, 80000);
  try {
    const loaded = new Promise((resolve) =>
      app.once('browser-window-created', (_, w) => {
        w.webContents.setAudioMuted(true);
        w.webContents.once('did-finish-load', () => resolve(w));
      }),
    );
    require('./offscreen-main.cjs').loadOffscreenMain();
    const w = await loaded;
    w.webContents.removeAllListeners('will-prevent-unload');
    w.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved layout QA close');
      app.exit(1);
    });
    w.webContents.debugger.attach('1.3');
    await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const js = (code) =>
      w.webContents.executeJavaScript(code, true).catch(async (error) => {
        console.error('Layout expression:', code);
        console.error(
          await w.webContents.executeJavaScript('document.body.innerText.slice(-1400)'),
        );
        throw error;
      });
    const until = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await pause(50);
      }
      throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText.slice(-1200)')));
    };
    const click = (text) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.closest('[hidden]')).click()`,
      );
    const named = (text) =>
      js(
        `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(text))}+']').click()`,
      );
    const field = (name, value) =>
      js(
        `(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(name))}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const status = () => js(`document.querySelector('.prototype-label')?.textContent`);
    const idle = () =>
      until(
        `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
      );
    const closeTopDialog = () =>
      js(
        `Array.from(document.querySelectorAll('[role="dialog"] > .dialog-header [aria-label="Закрыть окно"]')).at(-1).click()`,
      );
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
    await idle();
    assert.equal(await status(), '');
    await js('window.studio.loadStudio()');
    await pause(450);
    assert.equal(await status(), '', 'Background read is not a save');
    const menuAction = Menu.getApplicationMenu().getMenuItemById('check-updates');
    assert.ok(menuAction, 'Native menu contains manual check');
    menuAction.click();
    await until(
      `document.querySelector('[data-update-dialog]')?.textContent.includes('установленной версии')`,
    );
    assert.equal(
      await js(
        `document.querySelector('[data-update-dialog]').textContent.includes('Установлена актуальная')`,
      ),
      false,
    );
    await click('Понятно');
    await until(`!document.querySelector('[data-update-dialog]')`);
    const initialSettings = await js(
      `(()=>{const e=document.querySelector('.settings-button'),r=e.getBoundingClientRect();return {text:e.textContent,title:e.getAttribute('title'),width:r.width,x:r.x,y:r.y}})()`,
    );
    assert.equal(initialSettings.text.trim(), 'Настройки');
    assert.equal(initialSettings.title, null);
    assert.ok(initialSettings.width > 100);
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.settings-button')).backgroundColor`),
      await js(
        `getComputedStyle(document.querySelector('.topbar nav > button:not([aria-current="page"])')).backgroundColor`,
      ),
    );
    await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(initialSettings.x + 10),
      y: Math.round(initialSettings.y + 10),
    });
    await pause(150);
    assert.equal(await js(`!!document.querySelector('[role="tooltip"]')`), false);
    await click('Агенты');
    assert.equal(
      await js(`document.querySelector('.agent-list-group-heading').textContent`),
      'Мои команды',
    );
    await named('Создать команду');
    await field('Название команды', 'QA команда');
    assert.equal(await status(), '', 'Modal draft is not a persisted write');
    await click('Создать');
    await until(`document.querySelector('.prototype-label')?.textContent==='Сохраняем…'`);
    await idle();
    assert.equal(await status(), 'Сохранено');
    const firstConfirmation = Date.now();
    await pause(2150);
    await named('Добавить агента в «QA команда»');
    await idle();
    assert.equal(await status(), 'Сохранено');
    await pause(Math.max(0, firstConfirmation + 3200 - Date.now()));
    assert.equal(
      await status(),
      'Сохранено',
      'Old success timeout must not clear the newer success',
    );
    await until(`document.querySelector('.prototype-label')?.textContent===''`);
    assert.equal(
      await js(`document.querySelector('.settings-button').getBoundingClientRect().x`),
      initialSettings.x,
    );
    const geometry = await js(
      `(()=>{const p=document.querySelector('.agent-team-add'),a=document.querySelector('.agent-list-item'),s=getComputedStyle(p);return {plus:p.getBoundingClientRect().height,row:a.getBoundingClientRect().height,width:p.getBoundingClientRect().width,rowWidth:a.getBoundingClientRect().width,top:s.borderTopWidth,right:s.borderRightWidth,left:s.borderLeftWidth,bottom:s.borderBottomStyle,justify:s.justifyContent,icons:document.querySelector('.agent-team-icon').querySelectorAll('svg').length,transform:getComputedStyle(document.querySelector('.agent-team .ui-list-row-chevron')).transform}})()`,
    );
    assert.equal(geometry.plus, geometry.row);
    assert.equal(geometry.width, geometry.rowWidth);
    assert.equal(geometry.top, '0px');
    assert.equal(geometry.right, '0px');
    assert.equal(geometry.left, '0px');
    assert.equal(geometry.bottom, 'dashed');
    assert.equal(geometry.justify, 'center');
    assert.equal(geometry.icons, 3);
    assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(geometry.transform));
    await writeFile(
      join(root, 'team.png'),
      (await w.webContents.capturePage({ x: 0, y: 66, width: 320, height: 350 })).toPNG(),
    );
    await js(`document.querySelector('.agent-team .disclosure-trigger').click()`);
    assert.equal(
      await js(
        `document.querySelector('.agent-team .disclosure-trigger').getAttribute('aria-expanded')`,
      ),
      'false',
    );
    await pause(200);
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('.agent-team .ui-list-row-chevron')).transform`,
      ),
      'matrix(0, 1, -1, 0, 0, 0)',
    );
    await js(`document.querySelector('.agent-team .disclosure-trigger').click()`);
    await field('Название агента', 'QA saved agent');
    await idle();
    for (const tab of ['Skills', 'MCP', 'Плагины']) {
      await click(tab);
      await named('Добавить ' + tab);
      await until(`!!document.querySelector('[role="dialog"][data-size="wide"]')`);
      const checkWidth = async () => {
        const v = await js(
          `(()=>{const d=Array.from(document.querySelectorAll('[role="dialog"]')).at(-1),r=d.getBoundingClientRect();return {width:r.width,expected:Math.min(960,innerWidth-50),left:r.left,right:r.right,viewport:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}})()`,
        );
        assert.equal(Math.round(v.width), v.expected);
        assert.ok(v.left >= 25 && v.right <= v.viewport - 25 && v.scroll <= v.client + 1);
      };
      await checkWidth();
      if (tab === 'MCP') await click('Свой MCP');
      w.setMinimumSize(600, 600);
      w.setContentSize(800, 760);
      await until('innerWidth===800');
      await checkWidth();
      w.setContentSize(1512, 950);
      await until('innerWidth===1512');
      await checkWidth();
      const add =
        tab === 'Skills'
          ? 'Добавить навык'
          : tab === 'MCP'
            ? 'Добавить MCP-сервер'
            : 'Добавить пакет Pi';
      if (tab === 'Skills') {
        const point = await js(
          `(()=>{const r=document.querySelector('[aria-label="Добавить навык"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
        );
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
          await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type,
            ...point,
            button: type === 'mouseMoved' ? 'none' : 'left',
            clickCount: 1,
          });
      } else await named(add);
      if (tab === 'Skills') {
        await until(`!!document.querySelector('[role="menuitem"]')`);
        await js(
          `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Создать').click()`,
        );
      }
      await until(`document.querySelectorAll('[role="dialog"]').length===2`);
      await checkWidth();
      await closeTopDialog();
      await until(`document.querySelectorAll('[role="dialog"]').length===1`);
      await click('Готово');
    }
    failNext = true;
    await field('Название агента', 'Retry this edit');
    await until(`!!document.querySelector('.storage-error')`);
    assert.equal(await status(), 'Требуется внимание');
    await pause(3150);
    assert.equal(await status(), 'Требуется внимание', 'Errors have no success timeout');
    await click('Повторить сохранение');
    await idle();
    assert.equal(await status(), 'Сохранено');
    await js(
      `(async()=>{const s=await window.studio.loadStudio(),agents=structuredClone(s.sections.agents);agents[0].name='Changed outside the editor';const r=await window.studio.saveSection('agents',agents,{folder:s.folder,base:s.sections.agents});if(!r.saved)throw Error('Competing fixture write rejected');const e=document.querySelector('[aria-label="Название агента"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Conflicting local draft');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.equal(await status(), 'Требуется внимание');
    await js(
      `Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(e=>e.textContent.trim()==='Перечитать раздел').click()`,
    );
    await idle();
    assert.equal(await status(), '', 'Discarding the conflicting draft is not a save');
    await field('Название агента', 'Final saved agent');
    await idle();
    assert.equal(await status(), 'Сохранено');
    await js(`document.querySelector('[data-system-role="assistant"] .agent-list-item').click()`);
    for (const tab of ['Skills', 'MCP', 'Плагины']) {
      await click(tab);
      await named('Добавить ' + tab);
      await until(`!!document.querySelector('[role="dialog"][data-size="wide"]')`);
      assert.equal(
        await js(
          `Math.round(document.querySelector('[role="dialog"]').getBoundingClientRect().width)`,
        ),
        960,
      );
      await click('Готово');
    }
    const agentPresentation = await require('./agent-presentation-checks.cjs')({
      js,
      click,
      idle,
      until,
      w,
      pause,
    });
    await click('Настройки');
    await click('Выбрать папку');
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
    await idle();
    assert.equal(await status(), '', 'Changing studio resets previous success');
    assert.equal(await js('window.studio.loadStudio().then(s=>s.projects.length)'), 0);
    await writeFile(
      join(root, 'proof.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        version: require('../package.json').version,
        realMainPreloadRendererAndDiskPersistence: true,
        agentPresentation,
        controlledSaveDelayAndOneFailure: true,
        initialAndBackgroundReadNoSuccess: true,
        successOnlyAfterWrite: true,
        successExpiresAfterThreeSeconds: true,
        oldTimerCannotHideNewSuccess: true,
        errorRemainsUntilSuccessfulRetry: true,
        conflictDiscardDoesNotConfirmSave: true,
        studioChangeClearsConfirmation: true,
        settingsTextWithoutTooltipOrTitle: true,
        settingsPositionStable: true,
        teamHeadingThreeLucideUsersAndArrow: true,
        addAgentRowGeometry: true,
        wideCatalogsAndNestedFormsAllKinds: true,
        systemAgentCatalogsWide: true,
        nativeMenuManualActionReachesRealController: true,
        developmentRuntimeDoesNotClaimUpToDate: true,
        narrowViewportMargins: true,
        modelAndTerminalRequests: 0,
        qaIsolation:
          'Separate temporary studio/userData, accessory offscreen, mock Keychain, no OS focus/audio/clipboard. Parent waits actual exit before cleanup.',
      }),
    );
    clearTimeout(deadline);
    for (const own of BrowserWindow.getAllWindows()) own.destroy();
    app.exit(0);
  } catch (e) {
    clearTimeout(deadline);
    console.error(e);
    app.exit(1);
  }
}
(process.versions.electron ? child() : parent()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
