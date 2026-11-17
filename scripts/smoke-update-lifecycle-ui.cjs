if (!process.versions.electron) {
  const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const assert = require('node:assert/strict');
  const root = mkdtempSync(join(tmpdir(), 'pistudio-update-lifecycle-ui-'));
  try {
    const env = { ...process.env, PI_STUDIO_UPDATE_UI_QA_ROOT: root };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], {
      env,
      encoding: 'utf8',
      timeout: 45000,
      killSignal: 'SIGKILL',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout || child.error?.message);
    const proof = {
      ...JSON.parse(readFileSync(join(root, 'proof.json'), 'utf8')),
      realProcessExit: true,
    };
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/update-lifecycle-ui-proof.json',
      JSON.stringify(proof, null, 2) + '\n',
    );
    console.log(JSON.stringify(proof));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  // Actual application main/preload/renderer and isolated disk studio. Update states are controlled.
  const { app, ipcMain } = require('electron');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const root = process.env.PI_STUDIO_UPDATE_UI_QA_ROOT;
  if (!root) throw Error('Run this QA script through Node so its parent owns cleanup.');
  const data = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(data);
  app.setPath('userData', data);
  app.setPath('videos', root);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  const teamId = randomUUID();
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  const teams = [{ id: teamId, name: 'QA saved team', agentIds: [] }];
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { agents: [], agentTeams: teams } }),
  );
  const projectFiles = [];
  for (const [id, name, time] of [
    ['older', 'Точный открытый проект', 1],
    ['newer', 'Другой проект', 2],
  ]) {
    const folder = join(studio, 'projects', id);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, 'project.json'),
      text = JSON.stringify({
        schemaVersion: 1,
        id,
        name,
        sourceTeamId: teamId,
        createdAt: time,
        agents: [],
      });
    writeFileSync(path, text);
    projectFiles.push([path, text]);
  }
  let state = {
    phase: 'idle',
    currentVersion: require('../package.json').version,
    startup: {
      phase: 'starting',
      token: 'isolated-startup-token',
      message: 'Проверяем запуск обновлённой Studio…',
      view: { page: 'project', projectId: 'older' },
    },
  };
  let window,
    failed = false,
    launches = 0;
  const reports = [];
  const quitEvents = [];
  for (const name of ['before-quit', 'will-quit', 'quit'])
    app.on(name, () => {
      quitEvents.push(name);
      console.log('QA lifecycle: ' + name);
    });
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:update-state'
        ? () => structuredClone(state)
        : name === 'studio:update-readiness'
          ? (_event, ready) => {
              reports.push(ready);
            }
          : name === 'studio:startup'
            ? () => ({ phase: 'ready', message: 'Isolated QA, no Pi startup.' })
            : name === 'studio:launch-agent' || name === 'studio:open-setup-assistant'
              ? () => {
                  launches++;
                  throw Error('QA forbids model/Terminal requests');
                }
              : action,
    );
  const deadline = setTimeout(() => {
    failed = true;
    console.error('Full application update UI timed out');
    app.exit(1);
  }, 45000);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(read, predicate = Boolean) {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      const value = await read();
      if (predicate(value)) return value;
      await wait(30);
    }
    throw Error('Update application UI condition timed out');
  }
  const js = (code) => window.webContents.executeJavaScript(code);
  app.once('browser-window-created', (_event, value) => {
    window = value;
    window.webContents.setAudioMuted(true);
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      failed = true;
      console.error('QA attempted quit/reload before saved');
      app.exit(1);
    });
  });
  (async () => {
    const loaded = new Promise((resolve) =>
      app.once('browser-window-created', (_event, w) =>
        w.webContents.once('did-finish-load', resolve),
      ),
    );
    require('./offscreen-main.cjs').loadOffscreenMain();
    await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      failed = true;
      console.error('QA beforeunload was prevented');
      app.exit(1);
    });
    await until(() =>
      js(`document.querySelector('.project-header h1')?.textContent==='Точный открытый проект'`),
    );
    assert.equal(window.isVisible(), false);
    assert.equal(await js(`document.querySelector('.update-workspace').inert`), true);
    await until(async () =>
      reports.some(
        (value) => value.startupToken === 'isolated-startup-token' && value.saved && value.hydrated,
      ),
    );
    assert.equal(launches, 0);
    await js(
      `(()=>{const modal=document.createElement('section');modal.id='qa-automatic-info';modal.setAttribute('role','dialog');modal.textContent='Existing automatic legacy information';document.querySelector('.update-workspace').append(modal);})()`,
    );
    await wait(650);
    assert.equal(
      reports.at(-1).saved,
      true,
      'An automatic dialog in the initially frozen new app cannot deadlock startup health',
    );
    await js(`document.getElementById('qa-automatic-info').remove()`);
    state = { ...state, startup: { ...state.startup, phase: 'committed', message: undefined } };
    await until(() => js(`!document.querySelector('.update-workspace').inert`));
    await js(`window.studio.setLanguage('ru')`);
    await until(() => js(`document.documentElement.lang==='ru'`));
    await js(`document.querySelector('.topbar .settings-button').click()`);
    await until(() => js(`!!document.querySelector('[aria-label="Настройки студии"]')`));
    const currentFolder = await js(`document.querySelector('.settings-content input').value`);
    const change = async (value) =>
      js(
        `(()=>{const input=document.querySelector('.settings-content input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await change(currentFolder + '-UNSAVED');
    await until(() => js(`!!document.querySelector('[data-unsaved-draft="true"]')`));
    await wait(650);
    assert.equal(reports.at(-1).saved, false, 'Unsaved folder draft must block update');
    await change(currentFolder);
    await until(async () => reports.at(-1)?.saved === true);
    assert.equal(launches, 0);
    for (const [path, text] of projectFiles) assert.equal(readFileSync(path, 'utf8'), text);
    const proof = {
      checkedAt: new Date().toISOString(),
      version: state.currentVersion,
      scope:
        'Actual complete application in accessory offscreen Electron, disk-backed isolated studio and production preload; controlled updater IPC states, not an installed update or GitHub acceptance.',
      initialApplicationFrozen: true,
      exactOlderProjectRestored: true,
      hydratedSavedStartupTokenReported: true,
      automaticFrozenDialogDoesNotDeadlockHealth: true,
      unfrozenOnlyAfterCommit: true,
      unsavedFolderDraftBlocksUpdate: true,
      projectFilesUnchanged: true,
      modelOrTerminalLaunches: launches,
      userStudioAccess: false,
      osFocusOrAudioOrClipboard: false,
    };
    writeFileSync(join(root, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  })()
    .catch((error) => {
      failed = true;
      console.error(error);
    })
    .finally(async () => {
      clearTimeout(deadline);
      if (window && !window.isDestroyed()) {
        if (!failed)
          await until(() =>
            js(
              `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
            ),
          ).catch(() => {
            failed = true;
          });
        if (failed) window.destroy();
      }
      const quitDeadline = setTimeout(() => {
        console.error('QA quit did not finish: ' + JSON.stringify(quitEvents));
        app.exit(1);
      }, 10000);
      app.once('quit', () => {
        clearTimeout(quitDeadline);
      });
      if (failed) {
        app.exit(1);
      } else app.quit();
    });
}
