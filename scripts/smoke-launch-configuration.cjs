const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, readFile, access } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary,
  launches = 0;
const deadline = setTimeout(() => {
  console.error('Launch configuration smoke timed out');
  app.exit(1);
}, 45000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-launch-config-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData');
  mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const account = {
    id: 'qa-account',
    name: 'QA account',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  const model = {
    connectionId: account.id,
    provider: account.providerId,
    id: 'qa-model',
    reasoning: 'Средний',
    temperature: '',
  };
  const models = {
    empty: undefined,
    connection: { ...model, connectionId: '' },
    model: { ...model, id: '' },
    reasoning: { ...model, reasoning: '' },
    'deleted-account': { ...model, connectionId: 'missing' },
    'wrong-provider': { ...model, provider: 'other' },
    valid: model,
    'current-valid': model,
    'current-missing': { ...model, reasoning: '' },
    bound: undefined,
  };
  const agents = Object.entries(models).map(([id, model]) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    ...(model ? { model } : {}),
  }));
  const snapshots = [
    ...agents,
    { ...agents[0], id: 'deleted-profile', name: 'deleted-profile' },
  ].map(({ instructions, ...profile }) => ({ profile, outputPath: `agents/${profile.id}/output` }));
  snapshots.find((a) => a.profile.id === 'current-valid').profile.model = { ...model, id: '' };
  snapshots.find((a) => a.profile.id === 'current-missing').profile.model = model;
  const bound = snapshots.find((a) => a.profile.id === 'bound');
  bound.session = {
    id: 'qa-session',
    path: 'agents/bound/sessions/dialog.jsonl',
    title: 'Original dialogue',
    createdAt: 1,
  };
  const projectDir = join(studio, 'projects', 'launch-states');
  for (const agent of snapshots) {
    mkdirSync(join(projectDir, agent.outputPath), { recursive: true });
    mkdirSync(join(projectDir, `agents/${agent.profile.id}/sessions`), { recursive: true });
  }
  const transcript = '{"type":"session","id":"qa-session"}\n';
  writeFileSync(join(projectDir, bound.session.path), transcript);
  const file = join(projectDir, 'project.json');
  writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      id: 'qa-project',
      name: 'Launch states',
      createdAt: 1,
      agents: snapshots,
    }),
  );
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { agents, connections: [account] } }),
  );
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:connection-status'
          ? () => ({ connectionId: account.id, provider: account.providerId, status: 'ready' })
          : name === 'studio:launch-agent'
            ? () => {
                launches++;
                throw Error('No model or Terminal request expected');
              }
            : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('../out/main/index.cjs');
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + code);
  };
  const row = (id) =>
    `Array.from(document.querySelectorAll('.project-agent-menu .section-menu-row')).find(row=>row.querySelector('.section-menu-label')?.textContent.endsWith(${JSON.stringify('. ' + id)}))`;
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Открыть проект «Launch states»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Launch states»"]').click()`);
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-row').length===11`);
  const before = await readFile(file, 'utf8');
  for (const agent of snapshots) {
    const configured = ['valid', 'current-valid'].includes(agent.profile.id),
      expr = row(agent.profile.id);
    assert.equal(
      await js(`${expr}.querySelector('.section-menu-description').textContent`),
      configured ? 'Не запускался' : 'Не подключена модель',
      agent.profile.id,
    );
    assert.equal(
      await js(`!!${expr}.querySelector('button[aria-label="Запустить"]')`),
      configured,
      agent.profile.id,
    );
    assert.equal(
      await js(`!!${expr}.querySelector('button[aria-label="Продолжить диалог"]')`),
      false,
    );
    assert.equal(
      await js(`!!${expr}.querySelector('button[aria-label="Другие варианты запуска"]')`),
      configured,
    );
    assert.equal(await js(`!!${expr}.querySelector('[aria-label="Показать в Finder"]')`), true);
    assert.equal(
      await js(`!!${expr}.querySelector('[aria-label="Удалить агента из проекта"]')`),
      true,
    );
  }
  await js(`${row('valid')}.querySelector('button[aria-label="Запустить"]').click()`);
  await until(`!!document.querySelector('.agent-first-message')`);
  await click('Отмена');
  const save = async (key, value) => {
    const before = await js('window.studio.loadStudio()');
    const result = await js(
      `window.studio.saveSection(${JSON.stringify(key)},${JSON.stringify(value)},${JSON.stringify({ folder: before.folder, base: before.sections[key] })})`,
    );
    assert.ok(result.saved);
  };
  await save(
    'agents',
    agents.map((a) =>
      a.id === 'empty' || a.id === 'bound'
        ? { ...a, model }
        : a.id === 'valid'
          ? { ...a, model: { ...model, reasoning: '' } }
          : a,
    ),
  );
  await until(
    `!!${row('empty')}.querySelector('button[aria-label="Запустить"]')&&!!${row('bound')}.querySelector('button[aria-label="Продолжить диалог"]')&&!${row('valid')}.querySelector('button[aria-label="Запустить"]')`,
  );
  assert.equal(
    await js(`${row('bound')}.querySelector('.section-menu-description').textContent`),
    'Диалог сохранён',
  );
  await save('connections', []);
  await until(
    `document.querySelectorAll('.project-agent-actions .split-button').length===0 && Array.from(document.querySelectorAll('.project-agent-menu .section-menu-description')).every(el=>el.textContent==='Не подключена модель')`,
  );
  await save('connections', [account]);
  await until(`!!${row('bound')}.querySelector('button[aria-label="Продолжить диалог"]')`);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(await readFile(join(projectDir, bound.session.path), 'utf8'), transcript);
  await assert.rejects(access(join(projectDir, '.pistudio/context')));
  assert.equal(launches, 0);
  clearTimeout(deadline);
  console.log(
    'Launch row configuration passed: missing connection/model/effort/profile, stale snapshots, existing dialogue, live constructor/account changes without refresh; launch and menu hidden, Finder/delete preserved; no session/context/model requests.',
  );
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(temporary, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.exit(1);
});
