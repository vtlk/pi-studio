const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, writeFile, readFile, access } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Library assignment smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-library-assignment-ui-'));
  const videos = join(temporary, 'Videos'),
    userData = join(temporary, 'UserData');
  mkdirSync(videos);
  mkdirSync(userData);
  app.setPath('videos', videos);
  app.setPath('userData', userData);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) =>
      window.webContents.executeJavaScript(code, true).catch((error) => {
        console.error('Failed system expression', code.slice(0, 180));
        throw error;
      });
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA attempted navigation before persistence finished');
    app.exit(1);
  });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(await js('document.body.innerText.slice(-1500)'));
    throw new Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const field = async (label, value) =>
    js(
      `(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]') ?? Array.from(document.querySelectorAll('label')).find(element=>element.textContent.trim().startsWith(${JSON.stringify(label)}))?.control;Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );

  const select = async (label, text) => {
    await js(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
    );
    await until(`!!document.querySelector('[role="option"]')`);
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent.includes(${JSON.stringify(text)})).click()`,
    );
  };
  const saved = async () => {
    await until(`!!document.querySelector('[data-save-state="idle"]')`);
    return js('window.studio.loadStudio()');
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.equal((await saved()).sections.systemAgents.length, 1);
  await click('Агенты');
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.agent-list-group-heading')).map(el=>el.textContent)`,
    ),
    ['Мои агенты', 'Системные'],
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.agent-helper-launch')).opacity`),
    '0',
  );
  await js(`document.querySelector('.agent-helper-launch').focus()`);
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.agent-helper-launch')).opacity`),
    '1',
  );
  await js(`document.querySelector('.agent-helper-launch').click()`);
  await until(
    `document.querySelector('.toast')?.textContent.includes('Выберите подключение, модель и уровень рассуждения')`,
  );
  await assert.rejects(
    access(join((await js('window.studio.loadStudio()')).folder, '.pistudio/setup-assistant')),
  );
  await js(`document.querySelector('[aria-label="Создать команду"]').click()`);
  await field('Название команды', 'Library QA');
  await click('Создать');
  await js(`document.querySelector('[aria-label="Добавить агента в «Library QA»"]').click()`);
  await field('Название агента', 'Artist');
  const design = await js(
    `(()=>{const row=document.querySelector('.agent-list-item'),n=row.querySelector('.agent-list-number'),name=row.querySelector('.agent-list-name');return {height:row.offsetHeight,numberWidth:n.offsetWidth,number:n.textContent,font:getComputedStyle(name).fontSize,weight:getComputedStyle(name).fontWeight,background:getComputedStyle(document.querySelector('.agent-stages')).backgroundColor,toolbars:document.querySelectorAll('.agent-stages [role="toolbar"]').length}})()`,
  );
  assert.equal(design.height, 84);
  assert.ok(design.numberWidth >= 32, 'Number gutter may grow to fit multiple digits');
  assert.equal(design.number, '1');
  assert.equal(design.font, '17px');
  assert.equal(design.weight, '600');
  assert.equal(design.background, 'rgb(247, 247, 248)');
  assert.equal(design.toolbars, 0);
  await mkdir(resolve('artifacts'), { recursive: true });
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(
    resolve('artifacts/agent-constructor-list.png'),
    (await window.capturePage()).toPNG(),
  );
  await click('MCP');
  await js(`document.querySelector('[aria-label="Добавить MCP"]').click()`);
  await until(`!!document.querySelector('[aria-label="Источник MCP"]')`);
  await click('Свой MCP');
  assert.ok(await js(`!!document.querySelector('[aria-label="Добавить MCP-сервер"]')`));
  await click('Встроенные');
  await click('Добавить агенту');
  await click('Готово');
  await until(`document.querySelectorAll('.resource-binding').length===4`);
  const controls = await js(
    `Array.from(document.querySelectorAll('.resource-binding .ui-list-row-toggle')).map(el=>el.getBoundingClientRect().x)`,
  );
  assert.equal(controls.length, 4);
  assert.ok(
    controls.every((x) => x === controls[0]),
    'Project/Browser/Computer locks and Library switch share the control column',
  );
  assert.equal(await js(`!!document.querySelector('[data-builtin-mcp] .ui-list-row-icon')`), false);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(
    resolve('artifacts/mcp-lock-alignment.png'),
    (await window.capturePage()).toPNG(),
  );
  await saved();
  let state = await js('window.studio.loadStudio()');
  const artist = state.sections.agents[0].id;
  assert.deepEqual(state.sections.agents[0].mcps, ['pistudio-library']);
  assert.deepEqual(
    state.sections.resources,
    [],
    'Built-in assignment does not install an external resource',
  );
  await js(`document.querySelector('[aria-label="Использовать: pistudio-library"]').click()`);
  await saved();
  assert.equal(
    (await js('window.studio.loadStudio()')).sections.agents[0].capabilitySettings[
      'mcps:pistudio-library'
    ].enabled,
    false,
  );
  await js(`document.querySelector('[aria-label="Использовать: pistudio-library"]').click()`);
  await saved();
  await js(`document.querySelector('[aria-label="Добавить MCP"]').click()`);
  await until(`!!document.querySelector('[aria-label="Источник MCP"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="dialog"] .resource-row')).find(row=>row.querySelector('strong')?.textContent==='team').querySelector('button').click()`,
  );
  await click('Готово');
  await saved();
  assert.deepEqual((await js('window.studio.loadStudio()')).sections.agents[0].mcps, [
    'pistudio-library',
    'pistudio-team',
  ]);
  await js(`document.querySelector('[aria-label="Использовать: pistudio-team"]').click()`);
  await saved();
  assert.equal(
    (await js('window.studio.loadStudio()')).sections.agents[0].capabilitySettings[
      'mcps:pistudio-team'
    ].enabled,
    false,
  );
  await click('Skills');
  await js(`document.querySelector('[aria-label="Добавить Skills"]').click()`);
  await js(
    `document.querySelector('[aria-label="Добавить навык"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitem"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find(el=>el.textContent==='Создать').click()`,
  );
  await until(`!!document.querySelector('.skill-instructions-input')`);
  await field('Имя навыка', 'create-library-art');
  await field('Описание', 'Reusable library instructions');
  await field('Инструкции', 'Read library_get_contract and publish validated requested artwork.');
  await click('Сохранить');
  await until(`document.querySelectorAll('[role="dialog"]').length===1`);
  await click('Добавить агенту');
  await click('Готово');
  state = await saved();
  assert.equal(state.sections.resources.length, 1);
  assert.deepEqual(state.sections.agents[0].skills, [state.sections.resources[0].id]);
  const source = state.sections.resources[0].source;
  assert.ok(
    (await readFile(join(source, 'SKILL.md'), 'utf8')).includes('Read library_get_contract'),
  );
  await click('Библиотека');
  await js(`document.querySelector('[aria-label="Создать персонажа"]').click()`);
  await select('Агент библиотеки', 'Artist');
  await click('Отмена');
  state = await saved();
  assert.equal(state.sections.libraryAgents.characters, artist);
  assert.equal(state.sections.libraryAgents.locations, '');
  await js(
    `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.startsWith('Локации')).click()`,
  );
  await js(`document.querySelector('[aria-label="Создать локацию"]').click()`);
  assert.ok(
    (await js(`document.querySelector('[aria-label="Агент библиотеки"]').textContent`)).includes(
      'Выберите агента',
    ),
  );
  await select('Агент библиотеки', 'Artist');
  await field('Описание материала', 'A quiet garden');
  await click('Создать с Pi');
  await until(
    `document.querySelector('[role="alert"]')?.textContent.includes('Выберите подключение, модель и уровень рассуждения')`,
  );
  await click('Отмена');
  state = await saved();
  assert.deepEqual(state.sections.libraryAgents, { characters: artist, locations: artist });
  assert.deepEqual(state.projects, []);
  await assert.rejects(access(join(state.folder, '.pistudio/library-runs')));
  await click('Агенты');
  await click('MCP');
  await js(`document.querySelector('[aria-label="Убрать pistudio-library у агента"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('[role="alertdialog"] button').click()`);
  assert.deepEqual((await saved()).sections.agents[0].mcps, ['pistudio-library', 'pistudio-team']);
  await js(`document.querySelector('[aria-label="Убрать pistudio-library у агента"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('[role="alertdialog"] .button.primary').click()`);
  await saved();
  await click('Библиотека');
  await js(`document.querySelector('[aria-label="Создать персонажа"]').click()`);
  assert.ok(
    (await js(`document.querySelector('[aria-label="Агент библиотеки"]').textContent`)).includes(
      'недоступен',
    ),
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(el=>el.textContent==='Создать с Pi').disabled`,
    ),
    true,
  );
  await click('Отмена');
  await js(`document.querySelector('.settings-button').click()`);
  await click('MCP-серверы');
  const builtinRows = await js(
    `Array.from(document.querySelectorAll('.resource-catalog .resource-row')).map(el=>({name:el.querySelector('strong').textContent,delete:!!el.querySelector('.hover-delete'),actions:!!el.querySelector('.resource-native-actions'),button:el.querySelector('button').textContent}))`,
  );
  assert.deepEqual(
    builtinRows.map((item) => item.name),
    [
      'Pi Studio · Проект',
      'Pi Studio · Библиотека',
      'team',
      'Pi Studio · Браузер',
      'Pi Studio · Компьютер',
      'Pi Studio · Ресурсы и агенты',
    ],
  );
  assert.ok(
    builtinRows.every((item) => !item.delete && !item.actions && item.button === 'Сведения'),
  );
  await js(`document.querySelector('.resource-catalog .resource-row button').click()`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(
    await js(`document.querySelectorAll('[role="dialog"] input,[role="dialog"] textarea').length`),
    0,
  );
  await click('Закрыть');
  await click('Каталог Skills');
  await click('Редактировать');
  await until(
    `document.querySelector('.skill-instructions-input')?.value.includes('Read library_get_contract')`,
  );
  await field('Инструкции', 'Updated shared library rules.');
  await click('Сохранить');
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.ok(
    (await readFile(join(source, 'SKILL.md'), 'utf8')).includes('Updated shared library rules.'),
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/library-assignment-ui.png'),
    (await window.capturePage()).toPNG(),
  );
  await saved();
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  state = await js('window.studio.loadStudio()');
  assert.deepEqual(state.sections.libraryAgents, { characters: artist, locations: artist });
  assert.equal(state.sections.agents.length, 1);
  assert.equal(state.sections.systemAgents.length, 1);
  assert.equal(state.sections.resources.length, 1);
  console.log(
    'Library/team assignment UI passed: one helper; built-in/custom MCP picker, explicit binding/switch/confirmed removal; reusable skill create/assign/edit/current file; independent library choices and same profile for both; missing capability rejects without fallback/project/session; persistence/reload. No model requests.',
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
