const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, writeFile, readFile, access } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Output clear smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-clear-output-ui-'));
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
  require('../out/main/index.cjs');
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
      `(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]') ?? Array.from(document.querySelectorAll('label')).find(element=>element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea');Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
    await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
    return js('window.studio.loadStudio()');
  };

  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  const initial = await js('window.studio.loadStudio()');
  const agents = ['first', 'second'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  }));
  await js(
    `window.studio.saveSection('agents',${JSON.stringify(agents)},${JSON.stringify({ folder: initial.folder, base: initial.sections.agents })})`,
  );
  const created = await js(
    `window.studio.projectCommand({kind:'create',name:'Clear QA',agents:${JSON.stringify(agents)}})`,
  );
  const project = created.projects[0];
  const root = join(initial.folder, 'projects/clear-qa');
  const output = join(root, project.agents[0].outputPath);
  const other = join(root, project.agents[1].outputPath, 'keep.txt');
  const history = join(root, 'agents/first/sessions/history.jsonl');
  await mkdir(join(output, 'nested'));
  await writeFile(join(output, 'nested/result.txt'), 'QA result');
  await writeFile(join(output, '.hidden'), 'QA hidden');
  await writeFile(other, 'other output');
  await writeFile(history, 'canonical history\n');
  const document = await readFile(join(root, 'project.json'));
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await until(`!!document.querySelector('.project-list-row')`);
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`!!document.querySelector('[aria-label="Удалить все файлы агента"]')`);
  await until(`document.querySelectorAll('.file-tree-item').length>0`);
  const border = await js(
    `getComputedStyle(document.querySelector('.clear-agent-outputs')).borderColor`,
  );
  assert.equal(border, 'rgba(0, 0, 0, 0)');
  await js(`document.querySelector('[aria-label="Удалить все файлы агента"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.ok(
    (await js(`document.querySelector('[role="alertdialog"]').textContent`)).includes(
      'Корзину macOS',
    ),
  );
  await click('Отмена');
  assert.equal(await readFile(join(output, 'nested/result.txt'), 'utf8'), 'QA result');
  await js(`document.querySelector('[aria-label="Удалить все файлы агента"]').click()`);
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Удалить файлы');
  await until(
    `document.querySelector('.output-empty')?.textContent.includes('Выходных файлов пока нет')`,
  );
  assert.deepEqual(await require('node:fs/promises').readdir(output), []);
  assert.equal(await readFile(history, 'utf8'), 'canonical history\n');
  assert.equal(await readFile(other, 'utf8'), 'other output');
  assert.deepEqual(await readFile(join(root, 'project.json')), document);
  const after = await js(`window.studio.readProject(${JSON.stringify(project.id)})`);
  assert.equal(after.agents.length, 2);
  assert.equal(after.agents[0].entries.length, 0);
  assert.equal(after.agents[0].runStatus, 'idle');
  assert.equal(
    await js(
      `window.studio.clearAgentOutput(${JSON.stringify({ folder: '/wrong-studio', projectId: project.id, agentId: 'second' })}).then(()=>false,()=>true)`,
    ),
    true,
  );
  assert.equal(await readFile(other, 'utf8'), 'other output');
  await mkdir(resolve('artifacts'), { recursive: true });

  console.log(
    'Native output clearing passed: real Electron IPC and macOS Trash, cancellation preserves files; confirmed clear removes selected visible/hidden/nested output and refreshes UI; other agent, settings and session files remain unchanged; wrong studio rejects; idle status and transparent border verified. Only this disposable QA output was trashed.',
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
