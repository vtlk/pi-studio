const { app, ipcMain, dialog } = require('electron');
const { realpathSync, mkdirSync, writeFileSync } = require('node:fs');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timeout = setTimeout(() => {
  console.error('Team QA timeout');
  app.exit(1);
}, 85000);
(async () => {
  root = process.env.PI_STUDIO_TEAM_QA_ROOT;
  assert.ok(root && root.startsWith(join(realpathSync(tmpdir()), 'pistudio-teams-ui-')));
  assert.equal(root, realpathSync(root));
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(userData);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const packagePath = join(root, 'qa-export.pistudio-team');
  let cancelPicker = false,
    refuseSaves = false,
    saveGate,
    saveCount = 0;
  dialog.showSaveDialog = async () => {
    saveCount++;
    if (saveGate) await saveGate;
    return { canceled: cancelPicker, filePath: cancelPicker ? undefined : packagePath };
  };
  dialog.showOpenDialog = async () => ({
    canceled: cancelPicker,
    filePaths: cancelPicker ? [] : [packagePath],
  });
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:save-section'
          ? (...args) => {
              if (refuseSaves) throw Error('QA save unavailable');
              return action(...args);
            }
          : action,
    );
  const loaded = new Promise((resolveWindow) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => resolveWindow(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
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
      `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
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
  // Reorder through the actual keyboard sensor while a neighbouring team exists.
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const key = async (key, code, number, text = '') => {
    for (const type of ['keyDown', 'keyUp'])
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: number,
        ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}),
      });
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const openTeamMenu = async (id) => {
    await js(
      `document.querySelector('[data-team-id="'+${JSON.stringify(id)}+'"] .team-actions-menu').focus({preventScroll:true})`,
    );
    await key('Enter', 'Enter', 13);
    await until(`!!document.querySelector('[role="menu"]')`);
    assert.deepEqual(
      await js(`Array.from(document.querySelectorAll('[role="menuitem"]')).map(e=>e.textContent)`),
      ['Импорт команды', 'Экспорт команды', 'Удалить команду'],
    );
    assert.equal(
      await js(`document.querySelectorAll('[role="menu"] [role="separator"]').length`),
      1,
    );
  };
  const chooseTeamAction = async (label) => {
    await js(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent===${JSON.stringify(label)}).click()`,
    );
    await until(`!document.querySelector('[role="menu"]')`);
    await js('new Promise(r=>setTimeout(r,50))');
  };
  await js(`document.querySelector('.agent-team .agent-list-item').focus({preventScroll:true})`);
  await key(' ', 'Space', 32, ' ');
  await until(`!!document.querySelector('.agent-list-entry[data-dragging]')`);
  await key('ArrowDown', 'ArrowDown', 40);
  await js('new Promise(resolve=>setTimeout(resolve,350))');
  await key(' ', 'Space', 32, ' ');
  await until(`document.querySelector('.agent-team .agent-list-name')?.textContent==='Второй'`);
  await saved();
  const reordered = await load();
  assert.deepEqual(
    reordered.sections.agentTeams[0].agentIds,
    [...state.sections.agentTeams[0].agentIds].reverse(),
  );
  assert.deepEqual(reordered.sections.agentTeams[1], state.sections.agentTeams[1]);
  assert.deepEqual(
    reordered.sections.agents.filter((agent) =>
      state.sections.agentTeams[1].agentIds.includes(agent.id),
    ),
    state.sections.agents.filter((agent) =>
      state.sections.agentTeams[1].agentIds.includes(agent.id),
    ),
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
  await openTeamMenu(state.sections.agentTeams[1].id);
  await chooseTeamAction('Удалить команду');
  assert.equal((await load()).sections.agentTeams.length, 2, 'confirmation precedes mutation');
  await click('Отмена');
  await openTeamMenu(state.sections.agentTeams[1].id);
  await chooseTeamAction('Удалить команду');
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
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await writeFile(
    resolve('artifacts/agent-teams.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  const menuChecks = await require('./team-menu-checks.cjs')({
    js,
    until,
    click,
    field,
    saved,
    load,
    openTeamMenu,
    chooseTeamAction,
    packagePath,
    cancelPicker: (value) => {
      cancelPicker = value;
    },
    refuseSaves: (value) => {
      refuseSaves = value;
    },
    saveCalls: () => saveCount,
    blockSave: () => {
      let release;
      saveGate = new Promise((done) => {
        release = done;
      });
      return () => {
        saveGate = undefined;
        release();
      };
    },
  });
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Экспорт команды агентов').disabled`,
    ),
    true,
  );
  await named('Команда для экспорта');
  await until(`document.querySelectorAll('[role="option"]').length===2`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent==='Переименована').click()`,
  );
  await click('Экспорт команды агентов');
  await until(
    `document.querySelector('.settings-content [role="status"]')?.textContent.includes('Пакет сохранён')`,
  );
  assert.ok((await readFile(packagePath)).length > 0);
  const beforeImport = await load();
  cancelPicker = true;
  await click('Импорт команды агентов');
  await js('new Promise(resolve=>setTimeout(resolve,200))');
  assert.deepEqual((await load()).sections.agentCatalog, beforeImport.sections.agentCatalog);
  cancelPicker = false;
  await click('Импорт команды агентов');
  await until(
    `document.querySelector('[role="dialog"]')?.textContent.includes('Сначала настройте подключение Агента')`,
  );
  const imported = await load();
  assert.equal(imported.sections.agentTeams.length, 3);
  assert.deepEqual(
    imported.sections.agents.filter((agent) =>
      restored.sections.agents.some((previous) => previous.id === agent.id),
    ),
    restored.sections.agents,
  );
  const reports = await js(`window.studio.listTeamImports(${JSON.stringify(imported.folder)})`);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].handoff, 'pending');
  await click('Перейти');
  await until(`!!document.querySelector('.agent-model-panel')`);
  assert.equal(
    await js(
      `document.querySelector('.agent-list-item[aria-current="true"]').closest('[data-system-role]').getAttribute('data-system-role')`,
    ),
    'assistant',
  );
  assert.equal(await readFile(marker, 'utf8'), 'Keep output');
  await saved();
  const transferGuards = await require('./team-transfer-guard-checks.cjs')({
    js,
    until,
    click,
    saved,
    load,
    openTeamMenu,
    chooseTeamAction,
    packagePath,
    studio,
    root,
    saveCalls: () => saveCount,
    blockSave: () => {
      let release;
      saveGate = new Promise((done) => {
        release = done;
      });
      return () => {
        saveGate = undefined;
        release();
      };
    },
  });
  const proof = {
    checkedAt: new Date().toISOString(),
    nativeMain: true,
    packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
    version: (await js('window.studio.getInfo()')).version,
    isolatedOffscreen: true,
    emptyNoFallback: true,
    twoIndependentTeams: true,
    keyboardReorderPreservesNeighbourTeamAndProfiles: true,
    collapseRenameAdd: true,
    projectExplicitSelection: true,
    projectScopedToSelectedTeam: true,
    confirmationCancel: true,
    teamDeletePreservesProjectAndOutput: true,
    undoPreservesLaterEdits: true,
    reloadPersistence: true,
    nativeExportImportPicker: true,
    menuChecks,
    transferGuards,
    canceledImportPreservesCatalog: true,
    missingAssistantModelKeepsPackageAndTargetsExactModelTab: true,
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
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  app.exit(1);
});
