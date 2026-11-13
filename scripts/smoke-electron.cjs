const { app, BrowserWindow, dialog } = require('electron');
const { mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync } = require('node:fs');

// Exercise the built main/preload/renderer in a real, isolated macOS Electron process.
let temporary;
const deadline = setTimeout(() => {
  console.error('Desktop smoke timed out.');
  app.exit(1);
}, 45_000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-desktop-'));
  const documents = join(temporary, 'Documents');
  const userData = join(temporary, 'UserData');
  mkdirSync(documents);
  mkdirSync(userData);
  app.setPath('documents', documents);
  app.setPath('videos', documents);
  app.setPath('userData', userData);
  const loaded = new Promise((resolve, reject) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', () => resolve(window));
      window.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`${code}: ${description}`)),
      );
    }),
  );
  require('../out/main/index.cjs');
  const window = await loaded;
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Failed desktop expression:', code.slice(0, 250));
      throw error;
    });
  const save = async (section, value) => {
    const before = await js('window.studio.loadStudio()');
    const result = await js(
      `window.studio.saveSection(${JSON.stringify(section)},${JSON.stringify(value)},${JSON.stringify({ folder: before.folder, base: before.sections[section] })})`,
    );
    assert.ok(result.saved);
  };
  async function until(code) {
    for (let i = 0; i < 80; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    console.error(
      'Desktop state at timeout:',
      await js(
        `({status:document.querySelector('.prototype-label')?.textContent,error:document.querySelector('.storage-error')?.innerText,dialog:document.querySelector('[role="alertdialog"]')?.getAttribute('aria-label'),name:document.querySelector('[aria-label="Название агента"]')?.value,focused:document.hasFocus(),tooltips:Array.from(document.querySelectorAll('[role="tooltip"]')).map(item=>item.textContent),pointer:window.__statusPointerTrace})`,
      ),
    );
    throw new Error(`Desktop assertion timed out: ${code}`);
  }
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.equal(await js(`typeof window.studio.readOutput`), 'function');
  assert.equal(await js(`typeof window.require`), 'undefined');
  assert.equal(await js(`document.body.innerText.includes('Посылка с характером')`), false);
  const empty = await js(`window.studio.loadStudio()`);
  assert.deepEqual(empty.sections.agents, []);
  assert.deepEqual(empty.sections.connections, []);
  assert.deepEqual(empty.sections.resources, []);
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button => button.textContent.trim() === 'Библиотека').click()`,
  );
  assert.equal(await js(`document.querySelectorAll('.asset-thumb-wrap').length`), 0);
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button => button.textContent.trim() === 'Агенты').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Добавить агента"]')`);
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Новый агент'`);
  async function nameAgent(name) {
    await js(
      `(() => { const input=document.querySelector('[aria-label="Название агента"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
  }
  await nameAgent('Первый пользовательский агент');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Новый агент'`);
  await nameAgent('Выключенный пользовательский агент');
  await js(`document.querySelector('[role="switch"][aria-label="Агент включён"]').click()`);
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='Новый агент'`);
  await nameAgent('Третий пользовательский агент');
  await js(`document.querySelector('.agent-list-item').click()`);
  await until(
    `document.querySelector('[aria-label="Название агента"]')?.value==='Первый пользовательский агент'`,
  );
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  const constructorBeforeCreate = (await js(`window.studio.loadStudio()`)).sections.agents;
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button => button.textContent.trim() === 'Проекты').click()`,
  );
  await js(`document.querySelector('[aria-label="Создать проект"]').click()`);
  await until(`!!document.querySelector('[aria-label="Название проекта"]')`);
  await js(`(() => { const input = document.querySelector('[aria-label="Название проекта"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Desktop smoke');
    input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button => button.textContent.trim() === 'Создать').click()`,
  );
  await until(`!!document.querySelector('.project-header h1')`);
  const first = await js(`window.studio.loadStudio()`);
  assert.equal(first.projects.length, 1);
  const project = first.projects[0];
  assert.equal(project.name, 'Desktop smoke');
  assert.equal(project.agents.length, 3);
  assert.deepEqual(
    project.agents.map((item) => item.profile),
    constructorBeforeCreate.map(({ instructions, mainInstruction, ...profile }) => profile),
  );
  assert.equal(project.agents[1].profile.enabled, false);
  const outputPath = project.agents[0].outputPath;
  assert.equal(outputPath, 'agents/pervyy-polzovatelskiy-agent/output');
  const output = join(first.folder, 'projects/Desktop smoke', outputPath);
  await writeFile(
    join(output, 'проверка.md'),
    '# Файловый просмотр\n\n**Жирный текст** и обычный текст.\n\n<script>window.INJECTED=true</script>',
  );
  await until(`!!document.querySelector('.output-markdown h1')`);
  assert.equal(await js(`window.INJECTED`), undefined);
  assert.equal(
    await js(`document.querySelector('.output-markdown strong').textContent`),
    'Жирный текст',
  );
  assert.equal(await js(`!!document.querySelector('[aria-label="Показать в Finder"]')`), true);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/desktop-project.png'), (await window.capturePage()).toPNG());
  const apiRead = await js(
    `window.studio.readOutput({projectId:${JSON.stringify(project.id)},path:${JSON.stringify(`${outputPath}/проверка.md`)}})`,
  );
  assert.match(apiRead.content, /Файловый просмотр/);
  const projectJson = JSON.parse(
    await readFile(join(first.folder, 'projects/Desktop smoke/project.json'), 'utf8'),
  );
  assert.equal('mainInstruction' in projectJson.agents[0].profile, false);
  const check = await js(`window.studio.checkPi('')`);
  assert.equal(check.nativeMcp, true);
  assert.equal(check.exactSessions, true);
  const imagePath = `${outputPath}/pixel.png`;
  await writeFile(
    join(output, 'pixel.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB2sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const imageFile = await js(
    `window.studio.readOutput({projectId:${JSON.stringify(project.id)},path:${JSON.stringify(imagePath)}})`,
  );
  assert.match(imageFile.src, /^studio-media:/);
  const dimensions = await js(
    `new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve([image.naturalWidth,image.naturalHeight]); image.onerror = () => reject(new Error('Native media did not load')); image.src = ${JSON.stringify(imageFile.src)}; })`,
  );
  assert.deepEqual(dimensions, [1, 1]);
  const provider = await js(`window.studio.getProviderStatus('openai-codex')`);
  assert.ok(['ready', 'not_ready', 'invalid'].includes(provider.status));
  assert.deepEqual(Object.keys(provider).sort(), ['provider', 'status']);
  // The project toolbar deletion is confirmed before mutation and restores its original position.
  app.focus({ steal: true });
  window.focus();
  await until('document.hasFocus()');
  await js(
    `window.__statusPointerTrace=[];document.addEventListener('pointermove',event=>{window.__statusPointerTrace.push({x:event.clientX,y:event.clientY,target:event.target.getAttribute('aria-label')||event.target.tagName,status:event.target.closest('.agent-status-icon')?.dataset.status});window.__statusPointerTrace=window.__statusPointerTrace.slice(-10);},true);`,
  );
  const statusIcon = await js(`(() => {
    const element = document.querySelector('.agent-status-icon');
    const rect = element.getBoundingClientRect();
    return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  window.webContents.sendInputEvent({ type: 'mouseMove', ...statusIcon });
  await until(
    `Array.from(document.querySelectorAll('[role="tooltip"]')).some(item=>item.textContent==='Не запускался')`,
  );
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await js(
    `document.activeElement?.blur(); document.querySelector('[aria-label="Удалить агента из проекта"]').focus()`,
  );
  await until(
    `Array.from(document.querySelectorAll('[role="tooltip"]')).some(item=>item.textContent==='Удалить агента из проекта')`,
  );
  await js(`document.querySelector('[aria-label="Удалить агента из проекта"]').click()`);
  assert.equal((await js(`window.studio.loadStudio()`)).projects[0].agents.length, 3);
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button=>button.textContent==='Отмена').click()`,
  );
  assert.equal((await js(`window.studio.loadStudio()`)).projects[0].agents.length, 3);
  await js(`document.querySelector('[aria-label="Удалить агента из проекта"]').click()`);
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button=>button.textContent==='Удалить').click()`,
  );
  await until(
    `document.querySelector('.notice')?.textContent.includes('Агент убран') || document.body.innerText.includes('Агент убран из проекта')`,
  );
  const removed = await js(`window.studio.loadStudio()`);
  assert.equal(removed.projects[0].agents.length, 2);
  assert.equal(removed.sections.agents.length, 3);
  assert.equal(await readFile(join(output, 'проверка.md'), 'utf8'), apiRead.content);
  await js(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Вернуть').click()`,
  );
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-item').length===3`);
  assert.deepEqual(
    (await js(`window.studio.loadStudio()`)).projects[0].agents.map((item) => item.profile.id),
    project.agents.map((item) => item.profile.id),
  );
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await until(
    `Array.from(document.querySelectorAll('.section-menu-item')).some(button => button.textContent.trim() === 'Каталог Skills')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.section-menu-item')).find(button => button.textContent.trim() === 'Каталог Skills').click()`,
  );
  const skillFolder = join(temporary, 'local-skill');
  await mkdir(skillFolder);
  await writeFile(
    join(skillFolder, 'SKILL.md'),
    '---\nname: smoke-local-skill\ndescription: Native imported skill\n---\n\nCurrent skill body.',
  );
  const originalPicker = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [skillFolder] });
  await js(`document.querySelector('[aria-label="Импортировать skill"]').click()`);
  await until(
    `Array.from(document.querySelectorAll('.resource-row strong')).some(item => item.textContent === 'smoke-local-skill')`,
  );
  dialog.showOpenDialog = originalPicker;
  const importedState = await js(`window.studio.loadStudio()`);
  const importedSkill = importedState.sections.resources.find(
    (item) => item.name === 'smoke-local-skill',
  );
  assert.equal(importedSkill.localSkill, true);
  assert.equal('content' in importedSkill, false);
  await js(
    `Array.from(document.querySelectorAll('.resource-row')).find(row=>row.textContent.includes('smoke-local-skill')).querySelector('.resource-native-actions button').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.resource-row')).find(row=>row.textContent.includes('smoke-local-skill'))?.textContent.includes('Доступен')`,
  );
  const checkedSkill = (await js('window.studio.loadStudio()')).sections.resources.find(
    (item) => item.id === importedSkill.id,
  );
  assert.equal(checkedSkill.check.status, 'available');
  await js(
    `(() => { const row=Array.from(document.querySelectorAll('.resource-row')).find(row=>row.textContent.includes('smoke-local-skill')); Array.from(row.querySelectorAll('button')).find(button=>button.textContent==='Сведения').click(); })()`,
  );
  await until(`document.querySelector('.dialog-body')?.innerText.includes('Файл прочитан')`);
  assert.equal(await js(`document.querySelector('.dialog-body textarea')`), null);
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button => button.textContent.trim() === 'Закрыть').click()`,
  );
  // Edit through React, then verify automatic saving and hydration rather than only the IPC writer.
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(button => button.textContent.trim() === 'Агенты').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Название агента"]')`);
  await js(`(() => { const input = document.querySelector('[aria-label="Название агента"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Сохранённый агент');
    input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(`document.querySelector('.prototype-label').textContent.includes('Сохранено')`);
  const externalBefore = await js(`window.studio.loadStudio()`);
  await save(
    'agents',
    externalBefore.sections.agents.map((agent, index) =>
      index === 0 ? { ...agent, name: 'Изменён помощником' } : agent,
    ),
  );
  await until(
    `document.querySelector('[aria-label="Название агента"]')?.value==='Изменён помощником'`,
  );
  await nameAgent('Сохранённый агент');
  await until(`document.querySelector('.prototype-label').textContent.includes('Сохранено')`);
  // A helper writes between UI hydration and autosave: ordinary CRUD must reject the stale list.
  await js(`(async()=>{
    const before=await window.studio.loadStudio();
    const next=before.sections.agents.map((agent,index)=>index===0?{...agent,name:'Новая правка помощника'}:agent);
    const saved=await window.studio.saveSection('agents',next,{folder:before.folder,base:before.sections.agents});
    if(!saved.saved)throw new Error('Helper fixture save failed');
    const input=document.querySelector('[aria-label="Название агента"]');
    if(input.value!=='Сохранённый агент')throw new Error('The UI must still hold its earlier value');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Мой несохранённый черновик');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await until(
    `!!document.querySelector('[role="alertdialog"][aria-label="Настройки изменились"]')`,
  );
  assert.equal(
    (await js('window.studio.loadStudio()')).sections.agents[0].name,
    'Новая правка помощника',
  );
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(b=>b.textContent==='Вернуться к моим правкам').click()`,
  );
  assert.equal(
    await js(`document.querySelector('[aria-label="Название агента"]').value`),
    'Мой несохранённый черновик',
  );
  const concurrent = await js('window.studio.loadStudio()');
  await save(
    'agents',
    concurrent.sections.agents.map((agent, index) =>
      index === 0 ? { ...agent, name: 'Самая свежая правка помощника' } : agent,
    ),
  );
  await js(`document.querySelector('.storage-error button').click()`);
  await until(
    `!!document.querySelector('[role="alertdialog"][aria-label="Настройки изменились"]')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(b=>b.textContent==='Перечитать раздел').click()`,
  );
  await until(
    `document.querySelector('[aria-label="Название агента"]')?.value==='Самая свежая правка помощника'`,
  );
  await until(`document.querySelector('.prototype-label').textContent.includes('Сохранено')`);
  await nameAgent('Сохранённый агент');
  await until(`document.querySelector('.prototype-label').textContent.includes('Сохранено')`);
  const edited = await js(`window.studio.loadStudio()`);
  assert.equal(edited.sections.agents[0].name, 'Сохранённый агент');
  assert.notEqual(edited.projects[0].agents[0].profile.name, 'Сохранённый агент');
  // Save through the actual preload and reload the renderer to prove hydration and isolation.
  await save('agents', []);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const reopened = await js(`window.studio.loadStudio()`);
  assert.deepEqual(reopened.sections.agents, []);
  assert.equal(reopened.projects[0].agents.length, 3);
  // Migrate saved prototype defaults only after confirmation; custom profiles/project snapshots survive.
  const legacy = JSON.parse(
    execFileSync(
      'node',
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        "import {initialAgents} from './src/renderer/fixtures/agents.ts'; console.log(JSON.stringify(initialAgents));",
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8' },
    ),
  );
  await save('agents', [...legacy, ...edited.sections.agents]);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`document.querySelector('.dialog-body')?.innerText.includes('агенты — 6')`);
  assert.equal(
    (await js(`window.studio.loadStudio()`)).sections.agents.length,
    legacy.length + edited.sections.agents.length,
  );
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button => button.textContent === 'Отмена').click()`,
  );
  assert.equal(
    (await js(`window.studio.loadStudio()`)).sections.agents.length,
    legacy.length + edited.sections.agents.length,
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`document.querySelector('.dialog-body')?.innerText.includes('агенты — 6')`);
  await js(
    `Array.from(document.querySelectorAll('.dialog-footer button')).find(button => button.textContent === 'Убрать шаблоны').click()`,
  );
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  const cleaned = await js(`window.studio.loadStudio()`);
  assert.deepEqual(cleaned.sections.agents, edited.sections.agents);
  assert.deepEqual(cleaned.projects, reopened.projects);
  await js(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Вернуть').click()`,
  );
  await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
  const restored = await js(`window.studio.loadStudio()`);
  assert.deepEqual(
    restored.sections.agents.map((item) => item.id),
    [...legacy, ...edited.sections.agents].map((item) => item.id),
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/desktop-smoke.png'), (await window.capturePage()).toPNG());
  console.log(
    `Desktop smoke passed: preload, native create, real Markdown, script isolation, Finder action, Pi detection, native media, provider readiness, empty native defaults, native skill import, UI autosave, snapshot isolation, saved-state reload, legacy confirmation/cancel/undo preserving custom profiles and projects. Pi ${check.version}.`,
  );
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
    (error) => console.warn('Temporary Chromium cache cleanup deferred:', error.code),
  );
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  if (temporary)
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
