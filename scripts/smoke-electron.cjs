const { app, BrowserWindow, dialog } = require('electron');
const { mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
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
  async function until(code) {
    for (let i = 0; i < 80; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
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
  await until(`!!document.querySelector('[aria-label="Название агента"]')`);
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
  assert.equal(project.agents.length, 1);
  const agentId = project.agents[0].profile.id;
  const output = join(first.folder, 'projects/Desktop smoke/agents', agentId, 'output');
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
    `window.studio.readOutput({projectId:${JSON.stringify(project.id)},path:${JSON.stringify(`agents/${agentId}/output/проверка.md`)}})`,
  );
  assert.match(apiRead.content, /Файловый просмотр/);
  const projectJson = JSON.parse(
    await readFile(join(first.folder, 'projects/Desktop smoke/project.json'), 'utf8'),
  );
  assert.equal('mainInstruction' in projectJson.agents[0].profile, false);
  const check = await js(`window.studio.checkPi('')`);
  assert.equal(check.nativeMcp, true);
  assert.equal(check.exactSessions, true);
  const imagePath = `agents/${agentId}/output/pixel.png`;
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
    `Array.from(document.querySelectorAll('.resource-row')).find(row => row.textContent.includes('smoke-local-skill')).querySelector('button').click()`,
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
  const edited = await js(`window.studio.loadStudio()`);
  assert.equal(edited.sections.agents[0].name, 'Сохранённый агент');
  assert.notEqual(edited.projects[0].agents[0].profile.name, 'Сохранённый агент');
  // Save through the actual preload and reload the renderer to prove hydration and isolation.
  await js(`window.studio.saveSection('agents', [])`);
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const reopened = await js(`window.studio.loadStudio()`);
  assert.deepEqual(reopened.sections.agents, []);
  assert.equal(reopened.projects[0].agents.length, 1);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/desktop-smoke.png'), (await window.capturePage()).toPNG());
  console.log(
    `Desktop smoke passed: preload, native create, real Markdown, script isolation, Finder action, Pi detection, native media, provider readiness, empty native defaults, native skill import, UI autosave, snapshot isolation, saved-state reload. Pi ${check.version}.`,
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
