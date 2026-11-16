const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { app, ipcMain } = require('electron');
const { mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
let root, window;
const deadline = setTimeout(() => {
  console.error('README capture timed out');
  app.exit(1);
}, 120000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-readme-'));
  const data = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(data);
  mkdirSync(studio);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  app.setPath('userData', data);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'Documentation capture: no model requests' })
        : action,
    );
  const ready = new Promise((done) =>
    app.once('browser-window-created', (_event, value) => done(value)),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  window = await ready;
  await new Promise((done) => window.webContents.once('did-finish-load', done));
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('Unsaved documentation state: capture aborted.');
    window.destroy();
    app.exit(1);
  });
  window.setSize(1440, 900);
  window.webContents.setAudioMuted(true);
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let n = 0; n < 150; n++) {
      if (await js(`Boolean(${code})`)) return;
      await new Promise((done) => setTimeout(done, 40));
    }
    throw Error('Documentation UI did not settle.');
  };
  const saved = () =>
    until(
      `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
    );
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const capture = async (name) => {
    console.log('Capture: ' + name);
    await saved();
    await js(
      `document.activeElement?.blur(); new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))`,
    );
    await writeFile(resolve('docs/media', name), (await window.webContents.capturePage()).toPNG());
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await saved();
  let state = await js('window.studio.loadStudio()');
  assert.deepEqual(state.sections.agentTeams, []);
  assert.deepEqual(state.sections.agents, []);
  const roles = [
    [
      'Сценарист',
      'Вы — сценарист коротких историй.\n\nСначала определите идею и структуру. Опишите действия, детали и настроение каждой сцены.\n\nСохраняйте сценарий и раскадровку в своей папке output. Читайте результаты других агентов текущего проекта, если они нужны для задачи.',
    ],
    ['Сцены', 'Создавайте сцены по текущему сценарию. Уточняйте недостающие материалы в диалоге.'],
    [
      'Монтаж',
      'Собирайте материалы в видео через доступные инструменты и сохраняйте результаты в output.',
    ],
  ];
  const agents = roles.map(([name, mainInstruction]) => ({
    id: randomUUID(),
    name,
    mainInstruction,
    enabled: true,
    skills: [],
    mcps: [],
    plugins: [],
    instructions: [],
  }));
  const teamId = randomUUID();
  const catalog = {
    agents,
    teams: [{ id: teamId, name: 'Короткие истории', agentIds: agents.map((agent) => agent.id) }],
  };
  await js(
    `window.studio.saveSection('agentCatalog',${JSON.stringify(catalog)},${JSON.stringify({ folder: state.folder, base: state.sections.agentCatalog })})`,
  );
  let project;
  for (const name of ['Первый снег', 'Маленькие открытия', 'Город после дождя']) {
    const result = await js(
      `window.studio.projectCommand(${JSON.stringify({ kind: 'create', name, teamId, agents })})`,
    );
    project = result.projects.find((item) => item.id === result.selectedId);
    assert.ok(project);
  }
  const output = join(studio, 'projects', project.folderName, project.agents[0].outputPath);
  await mkdir(join(output, 'references'));
  const text =
    '# Город после дождя\n\nКороткая история о том, как замечать необычное в привычном.\n\n## Сцена 1. Первые капли\n\nТихий город после дождя. Улицы ещё влажные, в воздухе — свежесть и лёгкий запах асфальта.\n\nВ окне на втором этаже девушка смотрит на город, обнимая кружку с тёплым чаем.\n\n> Иногда стоит просто остановиться — и увидеть, как по-новому выглядит привычный город.\n\n## Сцена 2. Отражения\n\nНа тротуаре в лужах отражается золотое солнце и редкие белые облака. Прохожие идут по своим делам, их силуэты слегка плывут в воде.\n\n## Сцена 3. Новый маршрут\n\nДевушка выходит из дома и идёт по знакомой улице, но сегодня выбирает другой поворот. На перекрёстке она встречает маленькую собаку, которая радостно подбегает и машет хвостом.\n';
  await writeFile(join(output, 'scenario.md'), text);
  await writeFile(
    join(output, 'storyboard.md'),
    '# Раскадровка\n\nТри сцены, единое настроение.\n',
  );
  await saved();
  const loaded = new Promise((done) => window.webContents.once('did-finish-load', done));
  window.webContents.reload();
  await loaded;
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await saved();
  await capture('projects.png');
  await click('Агенты');
  await until(
    `document.querySelector('.agent-prompt-editor')||document.querySelector('textarea[aria-label="Основной промпт агента"]')`,
  );
  await capture('agents.png');
  await click('Проекты');
  await js(
    `Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')?.startsWith('Открыть проект «Город после дождя»')).click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='scenario.md')`,
  );
  await click('scenario.md');
  await until(`document.body.textContent.includes('Сцена 1. Первые капли')`);
  await capture('project.png');
  await js(`document.querySelector('.settings-button').click()`);
  await click('Команды агентов');
  await until(`document.body.textContent.includes('Экспорт команды агентов')`);
  await capture('team-transfer.png');
  state = await js('window.studio.loadStudio()');
  assert.equal(state.projects.length, 3);
  assert.equal(state.sections.agentTeams.length, 1);
  assert.equal(
    state.projects.every((item) => item.agents.every((agent) => !agent.session)),
    true,
  );
  await writeFile(
    resolve('artifacts/readme-capture-proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: require('../package.json').version,
        nativeMain: true,
        isolatedUserDataAndStudio: true,
        initialTeamsAndAgentsEmpty: true,
        screenshots: ['projects.png', 'agents.png', 'project.png', 'team-transfer.png'],
        dataOrigin:
          'Explicit documentation-only catalog/project CRUD through actual native IPC and local sample Markdown, not preinstalled data or generated model results.',
        sourceMainSha256: createHash('sha256')
          .update(await readFile(resolve('out/main/index.cjs')))
          .digest('hex'),
        modelRequests: 0,
        terminalOpened: false,
        userStudioChanged: false,
        osFocusChanged: false,
      },
      null,
      2,
    ) + '\n',
  );
  clearTimeout(deadline);
  window.destroy();
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  if (window && !window.isDestroyed()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
