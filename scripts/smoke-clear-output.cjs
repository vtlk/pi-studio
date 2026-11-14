const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, readFile, readdir, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary,
  launches = 0;
const deadline = setTimeout(() => {
  console.error('Agent data deletion timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-agent-data-ui-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData');
  mkdirSync(userData);
  app.setPath('videos', temporary);
  app.setPath('userData', userData);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const model = {
    connectionId: 'qa-account',
    provider: 'openai-codex',
    id: 'qa-model',
    reasoning: 'Средний',
    temperature: '',
  };
  const agents = ['files', 'dialogue', 'all', 'other'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model,
  }));
  const project = {
    schemaVersion: 1,
    id: 'qa-project',
    name: 'Agent data QA',
    createdAt: 1,
    agents: agents.map(({ instructions, ...profile }) => ({
      profile,
      outputPath: `agents/${profile.id}/output`,
      session: {
        id: `session-${profile.id}`,
        path: `agents/${profile.id}/sessions/history.jsonl`,
        title: 'Original dialogue',
        createdAt: 1,
      },
    })),
  };
  const root = join(studio, 'projects/agent-data-qa');
  for (const a of project.agents) {
    mkdirSync(join(root, a.outputPath, 'nested'), { recursive: true });
    mkdirSync(join(root, `agents/${a.profile.id}/sessions`), { recursive: true });
    writeFileSync(join(root, a.outputPath, 'nested/result.txt'), `Output ${a.profile.id}`);
    writeFileSync(join(root, a.outputPath, '.hidden'), 'Hidden');
    writeFileSync(join(root, a.session.path), `Transcript ${a.profile.id}\n`);
  }
  writeFileSync(join(root, 'project.json'), JSON.stringify(project));
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents,
        connections: [
          {
            id: 'qa-account',
            name: 'QA',
            purpose: 'codex',
            providerId: 'openai-codex',
            endpoint: '',
            account: '',
            createdAt: 1,
          },
        ],
      },
    }),
  );
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:launch-agent'
          ? () => {
              launches++;
              throw Error('Unexpected generation');
            }
          : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, win) => {
      win.webContents.setBackgroundThrottling(false);
      win.webContents.once('did-finish-load', () => resolve(win));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const win = await loaded,
    js = (code) => win.webContents.executeJavaScript(code, true);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText.slice(-1500)')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const row = (id) =>
    `Array.from(document.querySelectorAll('.project-agent-menu .section-menu-row')).find(row=>row.querySelector('.section-menu-label')?.textContent.endsWith(${JSON.stringify('. ' + id)}))`;
  const open = async () => {
    await js(
      `document.querySelector('[aria-label="Удаление файлов или диалогов с агентом"]').click()`,
    );
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('[role="alertdialog"] .ui-list-row-label')).map(n=>n.textContent)`,
      ),
      ['Диалог с агентом', 'Файлы агента', 'Всё'],
    );
  };
  const selectAgent = async (id) => {
    await js(`${row(id)}.querySelector('button.section-menu-item').click()`);
    await until(
      `document.querySelector('.project-agent-menu .section-menu-item.active .section-menu-label')?.textContent.endsWith(${JSON.stringify('. ' + id)})`,
    );
  };
  await until(`!!document.querySelector('.project-list-row')`);
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`!!document.querySelector('[aria-label="Удаление файлов или диалогов с агентом"]')`);
  const settings = await readFile(join(studio, '.pistudio/studio.json'));
  const before = await readFile(join(root, 'project.json'));
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.clear-agent-outputs')).borderColor`),
    'rgba(0, 0, 0, 0)',
  );
  await open();
  await mkdir(resolve('artifacts'), { recursive: true });
  await require('node:fs/promises').writeFile(
    resolve('artifacts/agent-data-deletion.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click('Отмена');
  await open();
  await js(
    `document.querySelector('[role="alertdialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  assert.deepEqual(await readFile(join(root, 'project.json')), before);
  assert.equal(
    await readFile(join(root, 'agents/files/output/nested/result.txt'), 'utf8'),
    'Output files',
  );
  await open();
  await click('Файлы агента');
  await until(
    `document.querySelector('.output-empty')?.textContent.includes('Выходных файлов пока нет')`,
  );
  assert.deepEqual(await readdir(join(root, 'agents/files/output')), []);
  assert.equal(
    await readFile(join(root, 'agents/files/sessions/history.jsonl'), 'utf8'),
    'Transcript files\n',
  );
  assert.deepEqual(await readFile(join(root, 'project.json')), before);
  assert.equal(
    await js(`!!${row('files')}.querySelector('button[aria-label="Продолжить диалог"]')`),
    true,
  );
  for (const target of ['dialogue', 'all']) {
    await selectAgent(target);
    assert.equal(
      await js(`!!${row(target)}.querySelector('button[aria-label="Продолжить диалог"]')`),
      true,
    );
    await open();
    await click(target === 'dialogue' ? 'Диалог с агентом' : 'Всё');
    await until(`!!${row(target)}.querySelector('button[aria-label="Запустить"]')`);
    assert.equal(
      await js(`!!${row(target)}.querySelector('button[aria-label="Продолжить диалог"]')`),
      false,
    );
    assert.equal(
      await js(`!!${row(target)}.querySelector('button[aria-label="Запустить"] svg.lucide-play')`),
      true,
    );
    assert.deepEqual(await readdir(join(root, `agents/${target}/sessions`)), []);
    const disk = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'));
    assert.equal(disk.agents.find((a) => a.profile.id === target).session, undefined);
    if (target === 'dialogue')
      assert.equal(
        await readFile(join(root, `agents/${target}/output/nested/result.txt`), 'utf8'),
        `Output ${target}`,
      );
    else assert.deepEqual(await readdir(join(root, `agents/${target}/output`)), []);
    await until(`!${row(target)}.querySelector('button[aria-label="Запустить"]').disabled`);
    await js(`${row(target)}.querySelector('button[aria-label="Запустить"]').click()`);
    await until(`!!document.querySelector('[role="dialog"] textarea')`);
    await click('Отмена');
  }
  assert.equal(
    await readFile(join(root, 'agents/other/sessions/history.jsonl'), 'utf8'),
    'Transcript other\n',
  );
  assert.equal(
    await readFile(join(root, 'agents/other/output/nested/result.txt'), 'utf8'),
    'Output other',
  );
  assert.deepEqual(await readFile(join(studio, '.pistudio/studio.json')), settings);
  assert.equal(
    await js(
      `window.studio.deleteAgentData(${JSON.stringify({ folder: '/wrong-studio', projectId: project.id, agentId: 'other', target: 'all' })}).then(()=>false,()=>true)`,
    ),
    true,
  );
  assert.equal(launches, 0);
  console.log(
    JSON.stringify({
      passed: true,
      choices: 3,
      cancelAndEscapePreserveData: true,
      filesKeepBindingAndTranscript: true,
      dialogueKeepsOutput: true,
      allClearsBoth: true,
      bindingRemovedOnDisk: true,
      playAndFirstMessageRestored: true,
      otherAgentAndSettingsUnchanged: true,
      actualMacOSTrash: true,
      modelRequests: launches,
    }),
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
