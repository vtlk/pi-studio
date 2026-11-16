const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { readFile, writeFile, rm, mkdir, realpath, readdir, access } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
let heldProjectId = '';
const heldReads = [];
const revealed = [];
shell.showItemInFolder = (path) => revealed.push(path);
const timeout = setTimeout(() => {
  console.error('Projects list QA timed out');
  app.exit(1);
}, 60000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-projects-list-'));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  const model = {
    connectionId: 'qa-ui-account',
    provider: 'openai-codex',
    id: 'qa-ui-model',
    reasoning: 'Низкий',
    temperature: '',
  };
  mkdirSync(userData);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const longName =
    'Очень длинное название проекта для проверки сокращения и подсказки — ' +
    'история большого города '.repeat(8);
  const longFolder = 'long-real-folder-' + 'physical-project-directory-'.repeat(7);
  const records = [
    ['city', 'Город после дождя', 'gorod-posle-dozhdya', 13, 4, 24],
    ['discoveries', 'Маленькие открытия', 'malenkie-otkrytiya', 12, 3, 18],
    ['morning', 'История одного утра', 'istoriya-odnogo-utra', 10, 5, 42],
    ['fifth', 'Проверка снега', 'pervyy-sneg', 9, 1, 0],
    ['sixth', 'Проверка тумана', 'tuman', 8, 1, 0],
    ['long', longName, longFolder, 6, 3, 0],
  ];
  for (const [id, name, folder, day, agents, files] of [
    ...records,
    ['deleted', 'Удалённый проект', 'deleted', 1, 0, 0],
  ]) {
    const directory = join(studio, id === 'deleted' ? '.pistudio/trash' : 'projects', folder);
    mkdirSync(directory, { recursive: true });
    const snapshots = Array.from({ length: agents }, (_, n) => {
      const outputPath = `agents/agent-${n}/output`;
      mkdirSync(join(directory, outputPath), { recursive: true });
      return {
        profile: {
          id: `agent-${n}`,
          name: `QA ${n}`,
          enabled: true,
          skills: [],
          mcps: [],
          plugins: [],
          model,
        },
        outputPath,
      };
    });
    for (let n = 0; n < files; n++)
      writeFileSync(
        join(directory, snapshots[0].outputPath, `file-${n}.txt`),
        'Fixture result ' + n,
      );
    writeFileSync(
      join(directory, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id,
        name,
        createdAt: Date.UTC(2026, 10, day, 10),
        agents: snapshots,
      }),
    );
  }
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents: Array.from({ length: 5 }, (_, n) => ({
          id: `agent-${n}`,
          name: `QA ${n}`,
          enabled: true,
          skills: [],
          mcps: [],
          plugins: [],
          instructions: [],
          model,
        })),
        connections: [
          {
            id: model.connectionId,
            name: 'QA UI account',
            purpose: 'codex',
            providerId: model.provider,
            endpoint: '',
            account: '',
            createdAt: 1,
          },
        ],
      },
    }),
  );
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:read-project'
        ? (event, id) =>
            id === heldProjectId
              ? new Promise((_resolve, reject) => heldReads.push(reject))
              : action(event, id)
        : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, win) =>
      win.webContents.once('did-finish-load', () => resolve(win)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const win = await loaded;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Project list QA expression:', code);
      throw error;
    });
  const until = async (code) => {
    for (let n = 0; n < 150; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const input = (selector, value) =>
    js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const rows = () =>
    js(
      `Array.from(document.querySelectorAll('.projects-table tbody tr.project-list-item')).map(row=>({name:row.querySelector('.project-list-name').textContent,folder:row.querySelector('.project-list-folder').getAttribute('aria-label').split('. Папка: ')[1],date:row.querySelector('time').dateTime,counts:Array.from(row.querySelectorAll('.project-number')).map(e=>e.textContent)}))`,
    );
  const hover = async (selector) => {
    const rect = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...rect,
    });
  };
  await until(`document.querySelector('.projects-total')?.textContent==='6 проектов'`);
  await until(
    `Array.from(document.querySelectorAll('.project-list-item .project-number')).map(e=>e.textContent).join(',')==='4,24,3,18,5,42,1,0,1,0,3,0'`,
  );
  let displayed = await rows();
  assert.deepEqual(
    displayed.map((row) => row.name),
    records.map((row) => row[1]),
  );
  assert.deepEqual(
    displayed.map((row) => row.folder),
    records.map((row) => row[2]),
  );
  assert.equal(displayed[0].date, '2026-11-13T10:00:00.000Z');
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.projects-table thead th')).slice(0,5).map(e=>e.textContent)`,
    ),
    ['Проект', 'Потрачено', 'Создан', 'Агенты', 'Файлы'],
  );
  assert.equal(
    await js(`document.querySelector('[aria-label="Создать проект"]').textContent.trim()`),
    'Создать проект',
  );
  assert.equal(
    await js(`document.querySelector('.topbar').textContent.includes('PI STUDIO')`),
    false,
  );
  await input('[aria-label="Найти проект"]', ' МАЛЕНЬКИЕ ');
  assert.equal((await rows()).length, 1);
  assert.equal((await rows())[0].name, 'Маленькие открытия');
  await input('[aria-label="Найти проект"]', 'DOZHDYA');
  assert.equal((await rows())[0].folder, 'gorod-posle-dozhdya');
  await input('[aria-label="Найти проект"]', 'нет такого проекта');
  assert.equal((await rows()).length, 0);
  assert.equal(
    await js(`document.querySelector('.projects-empty').textContent`),
    'Проекты не найдены.',
  );
  await input('[aria-label="Найти проект"]', '');
  heldProjectId = 'discoveries';
  await js(`document.querySelector('[aria-label="Открыть проект «Маленькие открытия»"]').click()`);
  await until(`document.querySelector('.project-header h1')?.textContent==='Маленькие открытия'`);
  for (let n = 0; n < 100 && !heldReads.length; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(heldReads.length, 'Hold the old selected project read before switching');
  await click('Проекты');
  await until(`document.querySelectorAll('.project-list-item').length===6`);
  await js(`document.querySelector('[aria-label="Открыть проект «Город после дождя»"]').click()`);
  await until(`document.querySelector('.project-header h1')?.textContent==='Город после дождя'`);
  heldProjectId = '';
  for (const reject of heldReads.splice(0)) reject(new Error('QA_STALE_PROJECT_READ'));
  await js('window.studio.loadStudio()');
  await js('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(
    await js(
      `document.querySelector('.toast')?.textContent.includes('QA_STALE_PROJECT_READ')??false`,
    ),
    false,
    'A stale read failure must not report an error for the newly selected project',
  );
  await click('Проекты');
  await until(`document.querySelectorAll('.project-list-item').length===6`);
  heldProjectId = 'discoveries';
  await js(`document.querySelector('[aria-label="Открыть проект «Маленькие открытия»"]').click()`);
  await until(`document.querySelector('.project-header h1')?.textContent==='Маленькие открытия'`);
  for (let n = 0; n < 100 && !heldReads.length; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(heldReads.length);
  heldProjectId = '';
  for (const reject of heldReads.splice(0)) reject(new Error('QA_CURRENT_PROJECT_READ'));
  await until(`document.querySelector('.toast')?.textContent.includes('QA_CURRENT_PROJECT_READ')`);
  await js(`document.querySelector('[aria-label="Скрыть уведомление"]').click()`);
  await click('Проекты');
  await until(`document.querySelectorAll('.project-list-item').length===6`);
  await js(`document.activeElement.blur()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 10,
    y: 90,
  });
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.project-row-actions')).opacity`),
    '0',
  );
  await js(`document.querySelector('.project-list-row').focus()`);
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.project-row-actions')).opacity`),
    '1',
  );
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r',
    unmodifiedText: '\r',
  });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await until(`document.querySelector('.project-header h1')?.textContent==='Город после дождя'`);
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.project-column-heading')).map(e=>e.textContent)`,
    ),
    ['Агенты проекта', 'Файлы агента'],
  );
  const workspaceStyle = await js(
    `(()=>{const name=document.querySelector('.project-agent-menu .section-menu-label'), icon=document.querySelector('.agent-status-icon svg'),button=document.querySelector('.project-agent-menu .section-menu-item');return {name:getComputedStyle(name).fontSize,weight:getComputedStyle(name).fontWeight,iconWidth:icon.getBoundingClientRect().width,iconBeforeName:icon.getBoundingClientRect().right<name.getBoundingClientRect().left,status:button.querySelector('.section-menu-description').textContent,refresh:getComputedStyle(document.querySelector('.project-header .button')).backgroundColor,agentsBg:getComputedStyle(document.querySelector('.project-agent-menu')).backgroundColor,filesBg:getComputedStyle(document.querySelector('.output-files-pane')).backgroundColor}})()`,
  );
  assert.equal(workspaceStyle.name, '17px');
  assert.equal(workspaceStyle.weight, '600');
  assert.equal(workspaceStyle.iconWidth, 32);
  assert.equal(workspaceStyle.iconBeforeName, true);
  assert.equal(workspaceStyle.status.includes('Не запускался'), false);
  assert.ok(workspaceStyle.status.includes('·'), 'The subtitle contains accumulated metrics only');
  assert.equal(workspaceStyle.refresh, 'rgb(39, 39, 42)');
  assert.equal(
    workspaceStyle.agentsBg,
    (await js('document.documentElement.dataset.theme')) === 'dark'
      ? 'rgb(34, 34, 33)'
      : 'rgb(247, 247, 248)',
  );
  assert.equal(workspaceStyle.filesBg, workspaceStyle.agentsBg);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.project-file-toolbar button')).every(button=>button.getAttribute('aria-label')==='Копировать')`,
    ),
    true,
    'File header contains no agent actions',
  );
  assert.notEqual(
    await js(
      `getComputedStyle(document.querySelector('.project-agent-actions .project-agent-launch')).backgroundColor`,
    ),
    'rgb(255, 255, 255)',
  );
  assert.equal(
    await js(
      `(()=>{const b=document.querySelector('.project-agent-menu .section-menu-item').getBoundingClientRect(),a=document.querySelector('.project-agent-actions').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<1})()`,
    ),
    true,
    'Actions stay on the same row as the agent',
  );
  const secondActions = '.project-agent-menu .section-menu-row:nth-child(2) .project-agent-actions';
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-menu-trigger')).opacity`,
    ),
    '0',
  );
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-launch')).opacity`,
    ),
    '1',
  );
  assert.equal(
    await js(
      `document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-launch').textContent`,
    ),
    '',
  );
  await hover('.project-agent-menu .section-menu-row:nth-child(2)');
  await until(
    `getComputedStyle(document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-menu-trigger')).opacity==='1'`,
  );
  await js(
    `document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-menu-trigger').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitem"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==="Показать в Finder").click()`,
  );
  for (let n = 0; n < 100 && !revealed.length; n++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    revealed[0],
    await realpath(join(studio, 'projects/gorod-posle-dozhdya/agents/agent-1/output')),
  );
  assert.equal(
    await js(
      `document.querySelector('.project-agent-menu [aria-current="true"] .section-menu-label').textContent`,
    ),
    '1. QA 0',
    'Folder action targets its own row without switching preview',
  );
  await js(
    `document.querySelector(${JSON.stringify(secondActions)}+' .project-agent-menu-trigger').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitem"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==="Удалить агента из проекта").click()`,
  );
  await until(`document.querySelector('[role="alertdialog"]')?.textContent.includes('QA 1')`);
  await click('Отмена');
  assert.equal(
    await js(`document.querySelectorAll('.project-agent-menu .section-menu-row').length`),
    4,
  );
  await js(
    `document.querySelector('[aria-label="Ширина колонки агентов"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`,
  );
  await until(
    `document.querySelector('[aria-label="Ширина колонки агентов"]').getAttribute('aria-valuenow')==='200'`,
  );
  assert.equal(
    await js(
      `(()=>{const e=document.querySelector('.project-agent-menu .section-menu');return e.scrollWidth<=e.clientWidth})()`,
    ),
    true,
    'Actions fit the narrow agent column',
  );
  for (let i = 0; i < 12; i++)
    await js(
      `document.querySelector('[aria-label="Ширина колонки агентов"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
    );
  await hover('.agent-status-icon');
  await until(`document.querySelector('[role="tooltip"]')?.textContent==='Не запускался'`);
  await js(`document.querySelector('.project-agent-menu .section-menu-item').focus()`);
  assert.equal(await js(`getComputedStyle(document.activeElement).outlineStyle`), 'none');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/project-workspace.png'), (await win.capturePage()).toPNG());
  await click('Проекты');
  await until(`document.querySelectorAll('.project-list-item').length===6`);
  await js(
    `document.querySelectorAll('.project-list-item')[1].querySelector('.project-created').click()`,
  );
  await until(`document.querySelector('.project-header h1')?.textContent==='Маленькие открытия'`);
  await click('Проекты');
  await until(`document.querySelectorAll('.project-list-item').length===6`);
  await hover('.project-list-name');
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await js(`!!document.querySelector('[role="tooltip"]')`),
    false,
    'Short names do not repeat in a tooltip',
  );
  await hover('.project-list-item:last-child .project-list-name');
  await until(
    `document.querySelector('[role="tooltip"]')?.textContent.includes(${JSON.stringify(longName)})`,
  );
  await hover('.project-list-item:last-child .project-list-folder');
  await until(
    `document.querySelector('[role="tooltip"]')?.textContent.includes(${JSON.stringify(longFolder)})`,
  );
  await hover('.project-list-item:first-child .project-created');
  await until(`!document.querySelector('.ui-tooltip')`);
  await until(
    `getComputedStyle(document.querySelector('.project-list-item .hover-delete')).opacity==='1'`,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/projects-list.png'), (await win.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="Переименовать Город после дождя"]').click()`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(
    await js(`!!document.querySelector('.project-header')`),
    false,
    'Rename does not open the project',
  );
  await input('.dialog-body input', 'Город после дождя — новая версия');
  await click('Переименовать');
  await until(`!document.querySelector('[role="dialog"]')`);
  await until(
    `document.querySelector('.project-list-folder')?.textContent.endsWith('gorod-posle-dozhdya-novaya-versiya')`,
  );
  assert.equal(
    await readFile(
      join(studio, 'projects/gorod-posle-dozhdya-novaya-versiya/agents/agent-0/output/file-0.txt'),
      'utf8',
    ),
    'Fixture result 0',
  );
  await js(
    `document.querySelector('[aria-label="Клонировать Город после дождя — новая версия"]').click()`,
  );
  await until(`!!document.querySelector('[role="dialog"]')`);
  await input('.dialog-body input', 'Копия для проверки');
  await click('Клонировать');
  await until(`document.querySelector('.projects-total')?.textContent==='7 проектов'`);
  await until(
    `document.querySelector('.project-list-item .project-number:last-of-type') || document.querySelector('.project-list-name')?.textContent==='Копия для проверки'`,
  );
  assert.equal((await rows())[0].name, 'Копия для проверки');
  const deleteSelector = '[aria-label="Удалить проект «Копия для проверки»"]';
  await js(`document.querySelector(${JSON.stringify(deleteSelector)}).click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal((await rows()).length, 7, 'Deletion waits for confirmation');
  await click('Отмена');
  assert.equal((await rows()).length, 7);
  await js(`document.querySelector(${JSON.stringify(deleteSelector)}).click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Удалить');
  await until(`document.querySelector('.projects-total')?.textContent==='6 проектов'`);
  await until(
    `document.querySelector('.projects-trash .disclosure-trigger')?.textContent.includes('2')`,
  );
  assert.equal(
    await js(
      `document.querySelector('.projects-trash .disclosure-trigger').getAttribute('aria-expanded')`,
    ),
    'false',
  );
  await js(`document.querySelector('.projects-trash .disclosure-trigger').click()`);
  await js(
    `Array.from(document.querySelectorAll('.projects-trash .disclosure-content .ui-list-row')).find(row=>row.textContent.includes('Копия для проверки')).querySelector('.ui-list-row-actions button').click()`,
  );
  await until(`document.querySelector('.projects-total')?.textContent==='7 проектов'`);
  await until(
    `Array.from(document.querySelectorAll('.project-list-item')).some(row=>row.querySelector('.project-list-name')?.textContent==='Копия для проверки'&&row.querySelectorAll('.project-number')[1]?.textContent==='24')`,
  );
  assert.equal(
    await readFile(
      join(studio, 'projects/kopiya-dlya-proverki/agents/agent-0/output/file-0.txt'),
      'utf8',
    ),
    'Fixture result 0',
  );
  const style = await js(
    `(()=>{const get=s=>{const e=document.querySelector(s),v=getComputedStyle(e);return {size:v.fontSize,weight:v.fontWeight,color:v.color,font:v.fontFamily}};return {name:get('.project-list-name'),folder:get('.project-list-folder'),heading:get('.projects-table th'),count:get('.projects-total'),create:get('.project-create-area'),search:get('.projects-search input'),trash:get('.projects-trash .disclosure-trigger')}})()`,
  );
  await input('[aria-label="Найти проект"]', 'проверк');
  assert.equal((await rows()).length, 4);
  for (const name of ['Проверка снега', 'Проверка тумана']) {
    const selector = `[aria-label="Удалить проект «${name}»"]`;
    await until(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    await click('Удалить');
    await until(`!document.querySelector('[role="alertdialog"]')`);
  }
  await until(`document.querySelectorAll('.project-list-item').length===5`);
  assert.equal(await js(`!!document.querySelector('.projects-list-toolbar')`), false);
  let small = await js('window.studio.loadStudio()');
  for (const project of small.trashProjects)
    await js(
      `window.studio.projectCommand({kind:'restore',projectId:${JSON.stringify(project.id)}})`,
    );
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('.projects-list-toolbar')`);
  assert.equal(
    await js(`!!document.querySelector('.projects-trash')`),
    false,
    'Empty trash has no screen element',
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.projects-search')).borderRadius`),
    '6px',
  );
  const beforeCreate = await js('window.studio.loadStudio()');
  await js(`document.querySelector('[aria-label="Создать проект"]').click()`);
  await until(`!!document.querySelector('[role="dialog"] input')`);
  assert.equal(await js(`document.querySelectorAll('[role="dialog"] input').length`), 1);
  assert.equal(await js(`document.querySelectorAll('[role="dialog"] textarea').length`), 0);
  await input('.dialog-body input', 'Отменённый проект');
  await click('Отмена');
  assert.equal(
    (await js('window.studio.loadStudio()')).projects.length,
    beforeCreate.projects.length,
  );
  await js(`document.querySelector('[aria-label="Создать проект"]').click()`);
  await until(`!!document.querySelector('[role="dialog"] input')`);
  await input('.dialog-body input', 'Новый мультфильм');
  await js(`document.querySelector('[aria-label="Команда агентов"]').click()`);
  await until(`!!document.querySelector('[role="option"]')`);
  await js(`document.querySelector('[role="option"]').click()`);
  await click('Создать');
  await until(`document.querySelector('.project-header h1')?.textContent==='Новый мультфильм'`);
  const createdState = await js('window.studio.loadStudio()');
  const created = createdState.projects.find((project) => project.name === 'Новый мультфильм');
  assert.equal(created.folderName, 'novyy-multfilm');
  assert.deepEqual(
    created.agents.map((agent) => agent.profile.id),
    beforeCreate.sections.agents.map((agent) => agent.id),
  );
  const createdRoot = join(createdState.folder, 'projects', created.folderName);
  for (const agent of created.agents) {
    assert.equal(Object.hasOwn(agent.profile, 'instructions'), false);
    assert.equal(Object.hasOwn(agent.profile, 'mainInstruction'), false);
    assert.deepEqual(await readdir(join(createdRoot, agent.outputPath)), []);
    assert.equal(agent.session, undefined);
  }
  await assert.rejects(access(join(createdRoot, '.pistudio/context')), { code: 'ENOENT' });
  await writeFile(
    join(createdRoot, created.agents[0].outputPath, 'retained.txt'),
    'keep active output',
  );
  await writeFile(
    join(createdRoot, created.agents[1].outputPath, 'archived.txt'),
    'keep archived output',
  );
  const globals = beforeCreate.sections.agents;
  const refreshed = [
    globals[4],
    { ...globals[0], name: 'Updated QA 0' },
    globals[2],
    globals[3],
    { ...globals[0], id: 'new-agent', name: 'New QA', enabled: false },
  ];
  const updated = await js(
    `window.studio.saveSection('agents',${JSON.stringify(refreshed)},${JSON.stringify({ folder: createdState.folder, base: globals })})`,
  );
  assert.ok(updated.saved);
  await click('Перечитать агентов');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal(await js(`!!document.querySelector('.agent-diff')`), false);
  await click('Отмена');
  assert.deepEqual(
    (await js('window.studio.readProject(' + JSON.stringify(created.id) + ')')).agents.map(
      (agent) => agent.profile.id,
    ),
    created.agents.map((agent) => agent.profile.id),
  );
  const comparison = async () => {
    await click('Перечитать агентов');
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    await click('Перечитать');
    await until(`!!document.querySelector('.agent-diff')`);
  };
  await comparison();
  await until(`document.querySelector('.agent-diff').textContent.includes('New QA')`);
  assert.equal(
    await js(
      `document.querySelector('[aria-label="Обновить изменённые профили"]').getAttribute('aria-checked')`,
    ),
    'false',
  );
  await click('Применить');
  await until(`!document.querySelector('.agent-diff')`);
  const synced = await js('window.studio.readProject(' + JSON.stringify(created.id) + ')');
  assert.deepEqual(
    synced.agents.map((agent) => agent.profile.id),
    refreshed.map((agent) => agent.id),
  );
  assert.equal(
    synced.agents.find((agent) => agent.profile.id === globals[0].id).profile.name,
    globals[0].name,
  );
  assert.ok(synced.archivedAgents.some((item) => item.agent.profile.id === globals[1].id));
  await comparison();
  await js(`document.querySelector('[aria-label="Обновить изменённые профили"]').click()`);
  await click('Применить');
  await until(`!document.querySelector('.agent-diff')`);
  const changed = await js('window.studio.readProject(' + JSON.stringify(created.id) + ')');
  const retained = changed.agents.find((agent) => agent.profile.id === globals[0].id);
  assert.equal(retained.profile.name, 'Updated QA 0');
  assert.equal(retained.outputPath, created.agents[0].outputPath);
  assert.equal(changed.agents.length, 5);
  assert.equal(
    await readFile(join(createdRoot, retained.outputPath, 'retained.txt'), 'utf8'),
    'keep active output',
  );
  assert.equal(
    await readFile(join(createdRoot, created.agents[1].outputPath, 'archived.txt'), 'utf8'),
    'keep archived output',
  );
  const removable = changed.agents.find((agent) => agent.profile.id === 'new-agent');
  await writeFile(join(createdRoot, removable.outputPath, 'undo.txt'), 'keep removed agent output');
  await js(
    `Array.from(document.querySelectorAll('.project-agent-menu .section-menu-row')).find(row=>row.querySelector('.section-menu-label').textContent.endsWith('New QA')).querySelector('.project-agent-menu-trigger').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitem"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Удалить агента из проекта').click()`,
  );
  await until(`document.querySelector('[role="alertdialog"]')?.textContent.includes('New QA')`);
  await click('Удалить');
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-row').length===4`);
  const removed = await js('window.studio.readProject(' + JSON.stringify(created.id) + ')');
  assert.ok(removed.archivedAgents.some((item) => item.agent.profile.id === 'new-agent'));
  assert.equal((await js('window.studio.loadStudio()')).sections.agents.length, 5);
  await click('Вернуть');
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-row').length===5`);
  const undone = await js('window.studio.readProject(' + JSON.stringify(created.id) + ')');
  assert.deepEqual(
    undone.agents.map((agent) => agent.profile.id),
    changed.agents.map((agent) => agent.profile.id),
  );
  assert.equal(
    await readFile(join(createdRoot, removable.outputPath, 'undo.txt'), 'utf8'),
    'keep removed agent output',
  );
  console.log(
    JSON.stringify({
      projectsList: true,
      realFolderAndCounts: true,
      orderAndDates: true,
      searchNameAndFolder: true,
      keyboardAndRowClick: true,
      clippedTooltipsOnly: true,
      renameCloneConfirmCancelRestore: true,
      createCancelAndCurrentConstructorSnapshot: true,
      confirmedAgentSyncAndExplicitProfileUpdate: true,
      activeAndArchivedOutputsPreserved: true,
      confirmedProjectAgentRemoveAndUndo: true,
      staleReadFailureIgnored: true,
      currentReadFailureStillVisible: true,
      noModelRequests: true,
      typography: style,
    }),
  );
  clearTimeout(timeout);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  // Finish read-only IPC already admitted by the final refresh before removing its fixture.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
