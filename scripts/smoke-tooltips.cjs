const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Tooltip smoke timed out');
  app.exit(1);
}, 45000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-tooltips-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData');
  for (const path of [userData, join(studio, '.pistudio')]) mkdirSync(path, { recursive: true });
  const longName = 'Полное название агента для проверки скрытого текста';
  const profiles = ['Коротко', longName].map((name, index) => ({
    id: 'agent-' + index,
    name,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { agents: profiles } }),
  );
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA reload before saved');
    app.exit(1);
  });
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      'Timed out ' +
        code +
        ' ' +
        (await js(
          `JSON.stringify({focus:document.hasFocus(),tooltips:Array.from(document.querySelectorAll('[role="tooltip"]')).map(item=>item.textContent),text:document.body.innerText.slice(-1200)})`,
        )),
    );
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const tooltips = () =>
    js(`Array.from(document.querySelectorAll('[role="tooltip"]')).map(item=>item.textContent)`);
  // Exercise pointer handlers in the isolated renderer without moving the user's OS cursor.
  const hover = async (selector) => {
    assert.ok(await js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
    await js(
      `(()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const previous=window.__qaTooltipTarget;if(previous)previous.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:document.body}));window.__qaTooltipTarget=null;document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:0,clientY:0}));})()`,
    );
    await until(`!document.querySelector('[role="tooltip"]')`);
    await js(
      `(()=>{const element=document.querySelector(${JSON.stringify(selector)});window.__qaTooltipTarget=element;const rect=element.getBoundingClientRect();element.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));})()`,
    );
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const created = await js(
    `window.studio.projectCommand({kind:'create',name:'Tooltip project',agents:[]})`,
  );
  const project = created.projects[0],
    output = join(studio, 'projects/tooltip-project', project.agents[0].outputPath);
  await writeFile(join(output, 'brief.md'), '# Brief');
  const longFile = 'Полное имя файла с результатами работы агента для проверки скрытого текста.md';
  await writeFile(join(output, longFile), '# Long result');
  await click('Агенты');
  await until('document.hasFocus()');
  const short = '.agent-list-item[aria-label^="1. Коротко"]';
  const long = '.agent-list-item[aria-label^="2. Полное название"]';
  await hover(short);
  assert.deepEqual(await tooltips(), [], 'Visible agent name must not produce a duplicate tooltip');
  await hover(long);
  assert.deepEqual(await tooltips(), [longName]);
  await js(`document.querySelector(${JSON.stringify(long)}).focus()`);
  await until(
    `document.querySelector('[role="tooltip"]')?.textContent===${JSON.stringify(longName)}`,
  );
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(`!document.querySelector('[role="tooltip"]')`);
  await hover('[data-system-role="assistant"] .agent-list-item');
  assert.deepEqual(await tooltips(), [], 'Fully visible system agent name must not be duplicated');
  await click('Проекты');
  await until(`document.querySelector('.prototype-label')?.textContent==='Сохранено'`);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('.project-list-row')`);
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-item').length===2`);
  await hover(
    '.project-agent-menu .section-menu-row:first-child .section-menu-item .section-menu-label',
  );
  assert.deepEqual(await tooltips(), [], 'Project agent text must not repeat visible name/status');
  await hover(
    '.project-agent-menu .section-menu-row:nth-child(2) .section-menu-item .section-menu-label',
  );
  assert.deepEqual(await tooltips(), ['2. ' + longName]);
  await hover('.project-agent-menu .section-menu-row:first-child .agent-status-icon');
  assert.deepEqual(await tooltips(), [], 'Visible status text needs no duplicate icon tooltip');
  await hover('.file-tree-item:first-child');
  // Select files by their text, independent of timestamps/platform ordering.
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(item=>item.textContent==='brief.md').classList.add('qa-short-file')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(item=>item.textContent===${JSON.stringify(longFile)}).classList.add('qa-long-file')`,
  );
  await hover('.qa-short-file');
  assert.deepEqual(await tooltips(), []);
  await hover('.qa-long-file');
  assert.deepEqual(await tooltips(), [longFile]);
  // A resized column reveals the full label: the tooltip must disappear without a reload.
  await js(
    `document.querySelector('[aria-label="Ширина колонки агентов"]').focus({preventScroll:true})`,
  );
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await hover(
    '.project-agent-menu .section-menu-row:nth-child(2) .section-menu-item .section-menu-label',
  );
  assert.deepEqual(
    await tooltips(),
    [],
    'Full label revealed by resizing must no longer have a tooltip',
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/tooltip-smoke.png'), (await window.capturePage()).toPNG());
  console.log(
    'Tooltip UI passed: visible project/system/constructor labels have no duplicate; clipped names/files expose full text, keyboard/Escape and resize work; status text is visible with no duplicate tooltip.',
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
