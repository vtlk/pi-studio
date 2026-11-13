const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { readFile, writeFile, rm, stat, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const deadline = setTimeout(() => {
  console.error('Project move smoke timed out');
  app.exit(1);
}, 45000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-moves-desktop-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData'),
    originalRoot = join(studio, 'projects/Before');
  const path = 'agents/example/sessions/original.jsonl';
  const history = '{"type":"session","id":"original","cwd":"/fixture/old"}\n';
  const profile = {
    id: 'example',
    name: 'Example',
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
  };
  const project = {
    schemaVersion: 1,
    id: 'project-example',
    name: 'Before',
    createdAt: 1,
    autoContinue: false,
    agents: [
      {
        profile,
        outputPath: 'agents/example/output',
        session: { id: 'original', title: 'Example', path, createdAt: 123 },
      },
    ],
  };
  for (const directory of [
    userData,
    join(originalRoot, 'agents/example/sessions'),
    join(originalRoot, 'agents/example/output'),
  ])
    mkdirSync(directory, { recursive: true });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(join(originalRoot, 'project.json'), JSON.stringify(project));
  writeFileSync(join(originalRoot, path), history);
  writeFileSync(join(originalRoot, 'agents/example/output/script.md'), '# Preserved result');
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('../out/main/index.cjs');
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      'Timed out: ' + code + ' ' + (await js('document.body.innerText.slice(-1200)')),
    );
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const name = (value) =>
    js(
      `(()=>{const input=document.querySelector('.dialog-body input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(`!!document.querySelector('[aria-label="Переименовать Before"]')`);
  await js(`document.querySelector('[aria-label="Переименовать Before"]').click()`);
  await until(`document.querySelector('.dialog-body')?.textContent.includes('История сохранится')`);
  await name('Cancelled');
  await click('Отмена');
  assert.equal((await js('window.studio.loadStudio()')).projects[0].name, 'Before');
  assert.equal(await readFile(join(originalRoot, path), 'utf8'), history);
  await js(`document.querySelector('[aria-label="Переименовать Before"]').click()`);
  await name('After');
  await click('Переименовать');
  await until(
    `!!document.querySelector('[aria-label="Клонировать After"]') && !document.querySelector('.dialog-body')`,
  );
  const renamed = (await js('window.studio.loadStudio()')).projects[0];
  assert.equal(renamed.id, project.id);
  assert.equal(renamed.agents[0].session.needsFork, true);
  await assert.rejects(stat(originalRoot), { code: 'ENOENT' });
  const newRoot = join(studio, 'projects/after');
  assert.equal(await readFile(join(newRoot, path), 'utf8'), history);
  await js(`document.querySelector('[aria-label="Клонировать After"]').click()`);
  await name('Copy');
  await click('Клонировать');
  await until(
    `!!document.querySelector('[aria-label="Переименовать Copy"]') && !document.querySelector('.dialog-body')`,
  );
  const saved = await js('window.studio.loadStudio()');
  const copy = saved.projects.find((item) => item.name === 'Copy');
  assert.notEqual(copy.id, project.id);
  assert.equal(copy.agents[0].session.needsFork, true);
  assert.equal(copy.autoContinue, false);
  assert.equal(await readFile(join(studio, 'projects/copy', path), 'utf8'), history);
  assert.equal(
    await readFile(join(newRoot, 'agents/example/output/script.md'), 'utf8'),
    '# Preserved result',
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/project-moves-smoke.png'),
    (await window.capturePage()).toPNG(),
  );
  console.log(
    'Native project moves passed: cancel preserves project; rename with bound session moves the folder and preserves IDs/history; clone is independent with its own fork binding.',
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
