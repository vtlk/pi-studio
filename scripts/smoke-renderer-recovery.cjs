const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-renderer-recovery-')));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    await new Promise((done, fail) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (data) => {
        log += data;
      });
      child.stderr.on('data', (data) => {
        log += data;
      });
      const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
      child.once('error', fail);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        code === 0 ? done() : fail(Error(log));
      });
    });
    const proof = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/renderer-recovery-proof.json',
      JSON.stringify(proof, null, 2) + '\n',
    );
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function child() {
  const { app, ipcMain, dialog } = require('electron');
  const root = process.argv[3];
  assert.ok(
    root.startsWith(join(require('node:fs').realpathSync(tmpdir()), 'pistudio-renderer-recovery-')),
  );
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  let dialogs = 0,
    agentLaunches = 0;
  dialog.showMessageBox = async () => {
    dialogs++;
    throw Error('Unexpected native recovery dialog');
  };
  dialog.showMessageBoxSync = () => {
    dialogs++;
    throw Error('Unexpected native unsaved-state dialog');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : ['studio:launch-agent', 'studio:setup-assistant'].includes(channel)
          ? () => {
              agentLaunches++;
              throw Error('No automatic Pi launch during recovery QA');
            }
          : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setAudioMuted(true);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  const timeout = setTimeout(() => {
    console.error('Renderer recovery QA timeout');
    app.exit(1);
  }, 55000);
  try {
    require('./offscreen-main.cjs').loadOffscreenMain();
    const window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved QA state before recovery');
      app.exit(1);
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((done) => setTimeout(done, 25));
      }
      throw Error('Condition not reached: ' + code);
    };
    const saved = `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`;
    await until(`!!document.querySelector('.app-shell') && ${saved}`);
    const studio = await js('window.studio.loadStudio()');
    const manifest = join(studio.folder, '.pistudio/studio.json');
    const before = await readFile(manifest);
    const mainPid = process.pid,
      windowId = window.id,
      contentsId = window.webContents.id;
    const reloaded = new Promise((done) => window.webContents.once('did-finish-load', done));
    // Simulate Electron's exit event without crashing a process or opening an OS crash reporter.
    window.webContents.emit('render-process-gone', {}, { reason: 'memory-eviction', exitCode: 0 });
    await reloaded;
    await until(`!!document.querySelector('.app-shell') && ${saved}`);
    assert.equal(window.id, windowId);
    assert.equal(window.webContents.id, contentsId);
    assert.equal(process.pid, mainPid);
    assert.ok(before.equals(await readFile(manifest)));
    const report = JSON.parse(await readFile(join(root, 'UserData/renderer-failure.json'), 'utf8'));
    assert.equal(report.reason, 'memory-eviction');
    assert.equal(dialogs, 0);
    assert.equal(agentLaunches, 0);
    const info = await js('window.studio.getInfo()');
    await writeFile(
      join(root, 'proof.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        candidateVersion: info.version,
        sourceMainPreloadRenderer: true,
        simulatedProcessGoneEvent: true,
        actualRendererReloadAndAppReady: true,
        savedStateBeforeReload: true,
        sameMainPid: true,
        sameWindowAndWebContents: true,
        studioSettingsUnchanged: true,
        boundedReasonDiagnosticWritten: true,
        nativeDialogs: dialogs,
        automaticAgentLaunches: agentLaunches,
        actualProcessCrashOrDesktopCapturePerformed: false,
        userStudioOrInstalledAppChanged: false,
        nativeWindowsAccepted: false,
      }),
    );
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(error.stack);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
