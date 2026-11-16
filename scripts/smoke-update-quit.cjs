// Real Electron will-quit ordering with the production close-admission function; no studio/model.
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  (async () => {
    const root = mkdtempSync(join(tmpdir(), 'pistudio-update-quit-'));
    try {
      mkdirSync(join(root, 'UserData'));
      const { build } = await import('vite');
      await build({
        configFile: false,
        publicDir: false,
        logLevel: 'error',
        build: {
          ssr: resolve('src/main/ipc/registerGracefulQuit.ts'),
          outDir: join(root, 'bundle'),
          rollupOptions: {
            external: ['electron'],
            output: { format: 'cjs', entryFileNames: 'quit.cjs' },
          },
        },
      });
      const { spawnSync } = require('node:child_process'),
        env = { ...process.env, PI_STUDIO_UPDATE_QUIT_QA: root };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawnSync(require('electron'), [__filename], {
        env,
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      const proof = JSON.parse(readFileSync(join(root, 'proof.json'), 'utf8'));
      assert.equal(proof.admissionAttempts, 2);
      assert.equal(proof.failedAdmissions, 1);
      assert.equal(proof.exited, true);
      assert.equal(proof.guardKeptProcessAlive, true);
      assert.equal(proof.noDrainBeforeAdmission, true);
      mkdirSync('artifacts', { recursive: true });
      writeFileSync('artifacts/update-quit-proof.json', JSON.stringify(proof, null, 2) + '\n');
      console.log(JSON.stringify(proof));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { app, BrowserWindow } = require('electron'),
    root = process.env.PI_STUDIO_UPDATE_QUIT_QA;
  app.setPath('userData', join(root, 'UserData'));
  require('./offscreen-main.cjs').configureQaRuntime();
  app.on('window-all-closed', () => {});
  const { registerGracefulQuit } = require(join(root, 'bundle/quit.cjs'));
  let attempts = 0,
    failed = 0,
    drains = 0,
    closed = 0,
    rejectAdmission;
  const gate = new Promise((_resolve, reject) => {
    rejectAdmission = reject;
  });
  const proof = {
    checkedAt: new Date().toISOString(),
    scope:
      'Production graceful-quit admission in real accessory Electron with controlled cancellation failure; no installed updater/GitHub/native Windows claim.',
    isolatedUserData: true,
    visibleWindows: false,
    modelOrTerminalRequests: 0,
  };
  const timeout = setTimeout(() => {
    console.error('Quit admission timed out');
    app.exit(1);
  }, 12000);
  const open = async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    window.webContents.setAudioMuted(true);
    await window.loadURL('data:text/html,Owned%20quit%20fixture');
    assert.equal(window.isVisible(), false);
    return window;
  };
  registerGracefulQuit(
    [
      {
        drain: async () => {
          drains++;
        },
      },
    ],
    [
      {
        close: () => {
          closed++;
        },
      },
    ],
    {
      close: () => {
        attempts++;
        return attempts === 1 ? gate : Promise.resolve();
      },
      failed: () => {
        failed++;
        try {
          assert.equal(drains, 0);
          assert.equal(closed, 0);
          proof.noDrainBeforeAdmission = true;
        } catch (error) {
          console.error(error);
          app.exit(1);
          return;
        }
        setTimeout(() => {
          void open()
            .then(() => app.quit())
            .catch((error) => {
              console.error(error);
              app.exit(1);
            });
        }, 20);
      },
    },
  );
  app.once('quit', () => {
    clearTimeout(timeout);
    assert.equal(drains, 1);
    assert.equal(closed, 1);
    writeFileSync(
      join(root, 'proof.json'),
      JSON.stringify({
        ...proof,
        admissionAttempts: attempts,
        failedAdmissions: failed,
        exited: true,
      }),
    );
  });
  void app.whenReady().then(async () => {
    await open();
    app.quit();
    setTimeout(() => {
      try {
        assert.equal(attempts, 1);
        assert.equal(drains, 0);
        proof.guardKeptProcessAlive = true;
        rejectAdmission(Error('Owned fixture: helper cancellation not confirmed'));
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    }, 100);
  });
}
