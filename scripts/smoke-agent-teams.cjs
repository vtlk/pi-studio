const { app, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timeout = setTimeout(() => {
  console.error('Team QA timeout');
  app.exit(1);
}, 85000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-teams-ui-'));
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(userData);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action);
  const loaded = new Promise((resolveWindow) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => resolveWindow(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  window.webContents.setAudioMuted(true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('Unsaved team QA reload');
    app.exit(1);
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error(code + '\n' + (await js('document.body.innerText.slice(-1800)')));
  };
  const named = (label) =>
    js(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
    );
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.closest('[hidden]')).click()`,
    );
  const field = (label, value) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const saved = () =>
    until(
      `document.querySelector('.prototype-label')?.textContent==='Сохранено'&&!document.querySelector('.storage-error')`,
    );
  const load = () => js('window.studio.loadStudio()');
  const createTeam = async (name) => {
    await named('Создать команду');
    await field('Название команды', name);
    await click('Создать');
    await saved();
  };
  const addAgent = async (team, name) => {
    await named(`Добавить агента в «${team}»`);
    await field('Название агента', name);
    await saved();
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual((await load()).sections.agentTeams, []);
  await named('Создать проект');
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='Создать').disabled`,
    ),
    true,
  );
  assert.ok(
    await js(
      `document.querySelector('[role="dialog"]').textContent.includes('Сначала создайте команду')`,
    ),
  );
  await click('Отмена');
  assert.equal((await load()).projects.length, 0);
  await click('Агенты');
  await createTeam('Первая');
  await addAgent('Первая', 'Первый');
  await addAgent('Первая', 'Второй');
  await createTeam('Вторая');
  await addAgent('Вторая', 'Другой');
  const state = await load();
  assert.equal(state.sections.agentTeams.length, 2);
  assert.deepEqual(
    state.sections.agentTeams.map((team) => team.agentIds.length),
    [2, 1],
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.agent-stages')).backgroundColor`),
    'rgb(247, 247, 248)',
  );
  await js(`document.querySelector('.agent-team .disclosure-trigger').click()`);
  assert.equal(await js(`document.querySelector('.agent-team .disclosure-content').hidden`), true);
  await js(`document.querySelector('.agent-team .disclosure-trigger').click()`);
  assert.equal(await js(`document.querySelector('.agent-team .disclosure-content').hidden`), false);
  await named('Переименовать команду «Первая»');
  await field('Название команды', 'Переименована');
  await click('Сохранить');
  await saved();
  await addAgent('Переименована', 'Третий');
  await click('Проекты');
  await named('Создать проект');
  await field('Название проекта', 'Из второй команды');
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='Создать').disabled`,
    ),
    true,
  );
  await named('Команда агентов');
  await until(`document.querySelectorAll('[role="option"]').length===2`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent==='Вторая').click()`,
  );
  await click('Создать');
  await until(`document.querySelector('.project-header h1')?.textContent==='Из второй команды'`);
  const project = (await load()).projects[0];
  assert.equal(project.sourceTeamId, state.sections.agentTeams[1].id);
  assert.deepEqual(
    project.agents.map((agent) => agent.profile.name),
    ['Другой'],
  );
  assert.equal(project.agents[0].session, undefined);
  assert.equal('instructions' in project.agents[0].profile, false);
  const marker = join(
    studio,
    'projects',
    project.folderName,
    project.agents[0].outputPath,
    'keep.md',
  );
  await writeFile(marker, 'Keep output');
  await click('Агенты');
  await named('Удалить команду «Вторая»');
  assert.equal((await load()).sections.agentTeams.length, 2, 'confirmation precedes mutation');
  await click('Отмена');
  await named('Удалить команду «Вторая»');
  await click('Удалить');
  await saved();
  assert.equal((await load()).sections.agentTeams.length, 1);
  assert.equal(await readFile(marker, 'utf8'), 'Keep output');
  // An Undo restores only this team; later additions to another team survive.
  await addAgent('Переименована', 'После удаления');
  await click('Вернуть');
  await saved();
  const restored = await load();
  assert.equal(restored.sections.agentTeams.length, 2);
  assert.equal(
    restored.sections.agents.some((agent) => agent.name === 'После удаления'),
    true,
  );
  assert.deepEqual(
    restored.projects[0].agents.map((agent) => agent.profile.id),
    project.agents.map((agent) => agent.profile.id),
  );
  await saved();
  window.webContents.reload();
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual((await load()).sections.agentCatalog, restored.sections.agentCatalog);
  await click('Агенты');
  assert.equal(await js(`document.querySelectorAll('.agent-team').length`), 2);
  await writeFile(
    resolve('artifacts/agent-teams.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  const proof = {
    checkedAt: new Date().toISOString(),
    nativeMain: true,
    isolatedOffscreen: true,
    emptyNoFallback: true,
    twoIndependentTeams: true,
    collapseRenameAdd: true,
    projectExplicitSelection: true,
    projectScopedToSelectedTeam: true,
    confirmationCancel: true,
    teamDeletePreservesProjectAndOutput: true,
    undoPreservesLaterEdits: true,
    reloadPersistence: true,
    userStudioChanged: false,
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/agent-teams-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    'Native agent teams: CRUD, explicit project team, preserved outputs, stable-ID Undo and reload passed.',
  );
  clearTimeout(timeout);
  window.destroy();
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  app.exit(1);
});
