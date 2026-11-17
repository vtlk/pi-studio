const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const cases = [];
  for (const mode of ['idle', 'computer-status']) {
    const root = mkdtempSync(join(tmpdir(), 'pistudio-native-quit-'));
    try {
      const env = { ...process.env, PI_STUDIO_QUIT_ROOT: root, PI_STUDIO_QUIT_MODE: mode };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [__filename], {
        env,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      const record = JSON.parse(readFileSync(join(root, 'quit.json'), 'utf8'));
      assert.equal(
        result.status,
        0,
        JSON.stringify({ mode, record, error: result.error?.message, stderr: result.stderr }),
      );
      assert.equal(record.windowClosed, true);
      assert.equal(record.quit, true);
      assert.equal(record.forcedExit, undefined);
      assert.equal(record.visible, false);
      if (mode === 'computer-status') assert.notEqual(record.computerPhase, 'unavailable');
      cases.push({ mode, ...record });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  writeFileSync(
    'artifacts/native-quit-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: require('../package.json').version,
        realProcessExit: true,
        windowsNotPredestroyed: true,
        isolatedUserData: true,
        permissionRequests: false,
        packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Native Quit passed: real process exits after closing its window, idle and after native Computer status.',
  );
} else {
  const { app, ipcMain } = require('electron');
  const root = process.env.PI_STUDIO_QUIT_ROOT;
  const record = {};
  const save = () => writeFileSync(join(root, 'quit.json'), JSON.stringify(record));
  const fail = (error) => {
    console.error(error);
    record.error = String(error);
    save();
    app.exit(1);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  setTimeout(() => {
    record.forcedExit = true;
    save();
    app.exit(1);
  }, 15000).unref();
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  for (const path of [userData, studio, join(studio, '.pistudio')]) mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: {} }),
  );
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : action,
    );
  app.on('quit', () => {
    record.quit = true;
    save();
  });
  app.once('browser-window-created', (_, window) => {
    window.webContents.setBackgroundThrottling(false);
    window.webContents.on('will-prevent-unload', () =>
      fail(Error('Saved idle window unexpectedly prevented Quit')),
    );
    window.on('closed', () => {
      record.windowClosed = true;
      save();
    });
    window.webContents.once('did-finish-load', async () => {
      try {
        const js = (code) => window.webContents.executeJavaScript(code, true);
        for (let i = 0; i < 150; i++) {
          if (await js(`!!document.querySelector('[data-save-state="idle"]')`)) break;
          if (i === 149) throw Error('Studio did not finish saving');
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        record.visible = window.isVisible();
        if (process.env.PI_STUDIO_QUIT_MODE === 'computer-status') {
          record.computerPhase = (await js('window.studio.getComputerState()')).phase;
        }
        save();
        app.quit();
      } catch (error) {
        fail(error);
      }
    });
  });
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
}
