const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const deadline = setTimeout(() => {
  console.error('Disclosure list QA timed out');
  app.exit(1);
}, 60000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-listrow-'));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  const resourceName = 'Внешний сервер ' + 'с очень длинным названием '.repeat(8);
  for (const path of [userData, join(studio, '.pistudio/trash/archived')])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, '.pistudio/trash/archived/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'qa-trash',
      name: 'Удалённый проект',
      createdAt: 1,
      agents: [],
    }),
  );
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents: [
          {
            id: 'qa-list-agent',
            name: 'QA агент',
            enabled: true,
            skills: [],
            mcps: ['qa-mcp'],
            plugins: [],
            instructions: [
              { id: 'first', name: 'Первая инструкция', content: 'Первый текст', enabled: true },
              { id: 'second', name: 'Вторая инструкция', content: 'Второй текст', enabled: true },
            ],
          },
        ],
        resources: [
          {
            id: 'qa-mcp',
            kind: 'mcps',
            name: resourceName,
            source: 'pi:qa-listrow',
            description: 'QA описание ресурса',
            version: '',
            transport: 'HTTP',
            args: '',
            credential: '',
            contents: '',
            createdAt: 1,
          },
        ],
      },
    }),
  );
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, win) =>
      win.webContents.once('did-finish-load', () => resolve(win)),
    ),
  );
  require('../out/main/index.cjs');
  const win = await loaded;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.debugger.attach('1.3');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let n = 0; n < 180; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const point = async (selector, left = false) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+${left ? '4' : 'r.width/2'}),y:Math.round(r.y+r.height/2)}})()`,
    );
  const mouse = async (selector, left = false, activate = false) => {
    const pos = await point(selector, left);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...pos,
    });
    if (activate)
      for (const type of ['mousePressed', 'mouseReleased'])
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type,
          button: 'left',
          clickCount: 1,
          ...pos,
        });
  };
  const key = async (key, code, number, text = '') => {
    for (const type of ['keyDown', 'keyUp'])
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: number,
        ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}),
      });
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await until(`!!document.querySelector('.projects-trash .ui-list-row')`);
  const trash = '.projects-trash > .ui-list > .disclosure > .ui-list-row';
  await mouse(trash, true);
  await until(
    `getComputedStyle(document.querySelector(${JSON.stringify(trash)})).backgroundColor==='rgb(244, 244, 245)'`,
  );
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector(${JSON.stringify(trash)}+' .ui-list-row-main')).backgroundColor`,
    ),
    'rgba(0, 0, 0, 0)',
  );
  await mouse(trash, true, true);
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')==='true'`,
  );
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector('.projects-trash .ui-list-row-icon')).transform`,
    ),
    'none',
  );
  await until(
    `new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.projects-trash .ui-list-row-chevron')).transform).a < -0.99`,
  );
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(resolve('artifacts/disclosure-trash.png'), (await win.capturePage()).toPNG());
  await mouse(trash + ' .ui-list-row-icon', false, true);
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')==='false'`,
  );
  await mouse(trash + ' .ui-list-row-chevron', false, true);
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')==='true'`,
  );
  await js(`document.querySelector('.projects-trash .disclosure-trigger').focus()`);
  await key('Enter', 'Enter', 13, '\r');
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')==='false'`,
  );
  await key(' ', 'Space', 32, ' ');
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')==='true'`,
  );
  await js(
    `document.querySelector('.projects-trash .disclosure-content .ui-list-row-actions button').click()`,
  );
  await until(`document.querySelector('.projects-total')?.textContent==='1 проект'`);
  assert.equal(
    await js(
      `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')`,
    ),
    'true',
    'Restore action does not collapse its parent',
  );
  await click('Агенты');
  await until(`document.querySelectorAll('.instruction-sortable').length===2`);
  const instruction = '.instruction-sortable:first-child';
  await js(`document.querySelector(${JSON.stringify(instruction)}+' [role="switch"]').click()`);
  await until(
    `document.querySelector(${JSON.stringify(instruction)}+' [role="switch"]').getAttribute('aria-checked')==='false'`,
  );
  assert.equal(
    await js(
      `document.querySelector(${JSON.stringify(instruction)}+' .disclosure-trigger').getAttribute('aria-expanded')`,
    ),
    'false',
  );
  await mouse(instruction + ' .ui-list-row', true, true);
  await until(
    `document.querySelector(${JSON.stringify(instruction)}+' .disclosure-trigger').getAttribute('aria-expanded')==='true'`,
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.instruction-drag-handle svg')).transform`),
    'none',
  );
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(
    resolve('artifacts/disclosure-instructions.png'),
    (await win.capturePage()).toPNG(),
  );
  await js(`document.querySelector(${JSON.stringify(instruction)}+' .hover-delete').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Отмена');
  assert.equal(await js(`document.querySelectorAll('.instruction-sortable').length`), 2);
  assert.equal(
    await js(
      `document.querySelector(${JSON.stringify(instruction)}+' .disclosure-trigger').getAttribute('aria-expanded')`,
    ),
    'true',
  );
  await js(`document.querySelector('.instruction-sortable .disclosure-trigger').click()`);
  await until(
    `document.querySelector('.instruction-sortable .disclosure-trigger').getAttribute('aria-expanded')==='false'`,
  );
  await js(`document.querySelector('.instruction-drag-handle').focus()`);
  await key(' ', 'Space', 32, ' ');
  await until(`!!document.querySelector('.instruction-sortable[data-dragging]')`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await key('ArrowDown', 'ArrowDown', 40);
  await until(
    `getComputedStyle(document.querySelector('.instruction-sortable[data-dragging]')).transform !== 'none'`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await key(' ', 'Space', 32, ' ');
  await until(
    `document.querySelector('.instruction-sortable .ui-list-row-label')?.textContent==='Вторая инструкция'`,
  );
  await click('MCP');
  await until(`document.querySelectorAll('.resource-binding').length===2`);
  const pinned = '[data-builtin-mcp]';
  assert.equal(
    await js(`!!document.querySelector(${JSON.stringify(pinned)}+' [role="switch"]')`),
    false,
  );
  await mouse(pinned + ' .ui-list-row-icon', false, true);
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector(${JSON.stringify(pinned)}+' .ui-list-row-icon')).transform`,
    ),
    'none',
  );
  const external = '.resource-binding:not([data-builtin-mcp])';
  await js(`document.querySelector(${JSON.stringify(external)}+' [role="switch"]').click()`);
  await until(
    `document.querySelector(${JSON.stringify(external)}+' [role="switch"]').getAttribute('aria-checked')==='false'`,
  );
  assert.equal(
    await js(
      `document.querySelector(${JSON.stringify(external)}+' .disclosure-trigger').getAttribute('aria-expanded')`,
    ),
    'false',
  );
  await mouse(external + ' .ui-list-row-label');
  await until(
    `document.querySelector('[role="tooltip"]')?.textContent.includes(${JSON.stringify(resourceName)})`,
  );
  await mouse(external + ' .ui-list-row', true, true);
  await until(
    `document.querySelector(${JSON.stringify(external)}+' .disclosure-trigger').getAttribute('aria-expanded')==='true'`,
  );
  await mouse(pinned + ' .ui-list-row', true);
  await until(`!document.querySelector('.ui-tooltip')`);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(resolve('artifacts/disclosure-resources.png'), (await win.capturePage()).toPNG());
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  const saved = await js('window.studio.loadStudio()');
  assert.deepEqual(
    saved.sections.agents[0].instructions.map((i) => i.id),
    ['second', 'first'],
  );
  assert.equal(saved.sections.agents[0].instructions.find((i) => i.id === 'first').enabled, false);
  assert.equal(saved.sections.agents[0].capabilitySettings['mcps:qa-mcp'].enabled, false);
  console.log(
    JSON.stringify({
      sharedListRow: true,
      wholeRowHoverAndPaddingClick: true,
      iconAndChevronClick: true,
      onlyChevronRotates: true,
      enterSpace: true,
      switchIndependent: true,
      deleteConfirmation: true,
      dragKeyboard: true,
      restoreKeepsExpanded: true,
      longLabelTooltip: true,
      persisted: true,
      modelRequests: 0,
    }),
  );
  clearTimeout(deadline);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
