const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { readFile, writeFile, rm, access } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timeout = setTimeout(() => fail(Error('Connection removal QA timed out')), 30000);
async function cleanup() {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-connection-removal-')));
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  for (const path of [userData, studio, join(studio, '.pistudio')]) mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const connection = {
    id: 'selected',
    name: 'Selected account',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  const other = { ...connection, id: 'other', name: 'Other account', createdAt: 2 };
  const model = {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-model',
    reasoning: 'Низкий',
    temperature: '',
  };
  const agent = {
    id: 'writer',
    name: 'QA Writer',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model,
  };
  const helper = { ...agent, id: 'helper', name: 'QA Setup assistant', systemRole: 'assistant' };
  const sections = { agents: [agent], systemAgents: [helper], connections: [connection, other] };
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections }),
  );
  const projectDir = join(studio, 'projects', 'dialogue');
  const output = join(projectDir, 'agents/writer/output');
  const sessions = join(projectDir, 'agents/writer/sessions');
  for (const path of [output, sessions]) mkdirSync(path, { recursive: true });
  const transcript = '{"type":"session","id":"qa-dialogue"}\n';
  writeFileSync(join(sessions, 'dialogue.jsonl'), transcript);
  writeFileSync(join(output, 'story.md'), '# Existing story\n');
  const projectFile = join(projectDir, 'project.json');
  const { instructions: _instructions, ...profile } = agent;
  writeFileSync(
    projectFile,
    JSON.stringify({
      schemaVersion: 1,
      id: 'dialogue',
      name: 'QA Dialogue',
      createdAt: 1,
      agents: [
        {
          profile,
          outputPath: 'agents/writer/output',
          session: {
            id: 'qa-dialogue',
            path: 'agents/writer/sessions/dialogue.jsonl',
            title: 'QA',
            createdAt: 1,
          },
        },
      ],
    }),
  );
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : name === 'studio:connection-status'
          ? (_, request) => ({
              connectionId: request.connectionId,
              provider: connection.providerId,
              status: 'ready',
            })
          : name === 'studio:model-catalog'
            ? () => ({ providers: [], models: [] })
            : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const saved = () => until(`!!document.querySelector('[data-save-state="idle"]')`);
  const state = () => js('window.studio.loadStudio()');
  const settings = async () => {
    await js(`document.querySelector('.settings-button').click()`);
    await click('Подключения');
  };
  const remove = async () => {
    await js(
      `document.querySelector('[aria-label="Удалить подключение Selected account"]').click()`,
    );
    await until(`!!document.querySelector('[role="alertdialog"]')`);
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await saved();
  const initial = await state();
  assert.equal(initial.projects.length, 1, JSON.stringify(initial.warnings));
  const projectBefore = await readFile(projectFile, 'utf8');
  await settings();
  await remove();
  const description = await js(`document.querySelector('[role="alertdialog"]').textContent`);
  for (const name of [agent.name, helper.name, 'QA Dialogue'])
    assert.ok(description.includes(name), 'Confirmation must include ' + name);
  assert.equal(
    (await state()).sections.connections.length,
    2,
    'Opening confirmation must not delete',
  );
  await click('Отмена');
  assert.deepEqual((await state()).sections.connections, initial.sections.connections);
  await remove();
  await js(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  await until(`!document.querySelector('[role="alertdialog"]')`);
  assert.deepEqual((await state()).sections.connections, initial.sections.connections);
  await remove();
  await js(`document.querySelector('[role="alertdialog"] .button.primary').click()`);
  await until(`!document.querySelector('[aria-label="Удалить подключение Selected account"]')`);
  await saved();
  const removed = await state();
  assert.deepEqual(removed.sections.connections, [other]);
  assert.deepEqual(removed.sections.agents, initial.sections.agents);
  assert.deepEqual(removed.sections.systemAgents, initial.sections.systemAgents);
  assert.equal(await readFile(projectFile, 'utf8'), projectBefore);
  // Main preflight must reject both bindings before model catalog/auth/session/context work.
  await assert.rejects(
    js(`window.studio.launchAgent({projectId:'dialogue',agentId:'writer',autoContinue:false})`),
    /Подключение агента отсутствует или изменено/,
  );
  await assert.rejects(
    js('window.studio.openSetupAssistant()'),
    /Подключение агента отсутствует или изменено/,
  );
  assert.equal(await readFile(join(sessions, 'dialogue.jsonl'), 'utf8'), transcript);
  await assert.rejects(access(join(projectDir, '.pistudio/runs')));
  await click('Вернуть');
  await saved();
  assert.deepEqual(
    (await state()).sections.connections.map((c) => c.id),
    ['other', 'selected'],
  );
  await remove();
  await js(`document.querySelector('[role="alertdialog"] .button.primary').click()`);
  await saved();
  const reloaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual((await state()).sections.connections, [other]);
  await click('Агенты');
  await click('Модель');
  await until(
    `document.querySelector('[aria-label="Подключение модели"]')?.textContent.includes('Подключение недоступно')`,
  );
  assert.equal(await js(`document.querySelector('[aria-label="Модель агента"]').disabled`), true);
  await js(`document.querySelector('[data-system-role="assistant"] button').click()`);
  await until(
    `document.querySelector('[aria-label="Подключение модели"]')?.textContent.includes('Подключение недоступно')`,
  );
  assert.deepEqual((await state()).sections.systemAgents[0].model, model);
  assert.equal(await readFile(projectFile, 'utf8'), projectBefore);
  assert.equal(await readFile(join(output, 'story.md'), 'utf8'), '# Existing story\n');
  assert.equal(window.isVisible(), false);
  await writeFile(
    'artifacts/connection-removal-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: require('../package.json').version,
        nativeMainPreload: true,
        isolatedOffscreen: true,
        ordinaryAndSystemAgentUsage: true,
        projectUsage: true,
        confirmCancelEscapeUndoAndReload: true,
        missingConnectionShown: true,
        projectAndHelperLaunchRejectMissingConnection: true,
        sameProviderAlternativeNotUsed: true,
        profilesSessionsAndOutputsUnchanged: true,
        modelRequests: 0,
        limits:
          'Startup/catalog/status fixtures only; no real OAuth, Keychain or Terminal actions.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Connection removal passed: ordinary/helper/project usage, confirmation/cancel/Escape/Undo/reload, missing-account preflight and no fallback or data changes.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
