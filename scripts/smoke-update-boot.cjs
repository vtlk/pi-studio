// Real compiled main/preload/renderer, with a path-bound synthetic transaction and stalled
// metadata read. No installed application, user studio, credentials, model or Terminal is used.
const { join, resolve, dirname } = require('node:path');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pistudio-update-boot-')));
  const { spawn } = require('node:child_process');
  (async () => {
    try {
      await new Promise((done, fail) => {
        const env = { ...process.env, PI_STUDIO_BOOT_QA_ROOT: root };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          fail(Error('Owned update boot QA timed out'));
        }, 25000);
        child.once('error', fail);
        child.once('exit', (code) => {
          clearTimeout(timer);
          code === 0 ? done() : fail(Error('Owned update boot QA failed: ' + code));
        });
      });
      const proof = JSON.parse(fs.readFileSync(join(root, 'proof.json'), 'utf8'));
      proof.actualProcessExit = true;
      fs.writeFileSync(
        process.env.PI_STUDIO_BOOT_EXPECT_BLOCKED
          ? 'artifacts/update-boot-previous-proof.json'
          : 'artifacts/update-boot-proof.json',
        JSON.stringify(proof, null, 2) + '\n',
      );
      console.log(JSON.stringify(proof));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
} else {
  const { app, ipcMain, dialog } = require('electron');
  const Module = require('node:module');
  const originalPromises = require('node:fs/promises');
  const { randomUUID } = require('node:crypto');
  const { pathToFileURL } = require('node:url');
  const root = process.env.PI_STUDIO_BOOT_QA_ROOT;
  if (!root || !fs.realpathSync(root).startsWith(fs.realpathSync(tmpdir()) + '/'))
    throw Error('Unowned QA root');
  const data = join(root, 'UserData'),
    studio = join(root, 'Studio'),
    target = join(root, 'Pi Studio.app');
  fs.mkdirSync(data);
  fs.mkdirSync(join(studio, '.pistudio'), { recursive: true });
  fs.writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: { agents: [], agentTeams: [], connections: [], resources: [] },
    }),
  );
  const preferences = join(data, 'workspace.json');
  fs.writeFileSync(preferences, JSON.stringify({ folder: studio }));
  app.setPath('userData', data);
  app.setPath('videos', root);
  const qa = require('./offscreen-main.cjs');
  qa.configureQaRuntime();
  const id = randomUUID(),
    nonce = randomUUID(),
    stage = join(root, '.pistudio-update-' + id);
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.mkdirSync(join(stage, 'startups'));
  fs.mkdirSync(join(target, 'Contents/MacOS'), { recursive: true });
  const executable = join(target, 'Contents/MacOS/Pi Studio');
  fs.writeFileSync(executable, 'inert QA identity');
  const previous = join(stage, 'previous/Pi Studio.app');
  fs.mkdirSync(previous, { recursive: true });
  const version = process.env.PI_STUDIO_BOOT_QA_VERSION || require('../package.json').version;
  const fileIdentity = (path) => {
    const s = fs.statSync(path, { bigint: true });
    return { dev: String(s.dev), ino: String(s.ino), birthtimeNs: String(s.birthtimeNs) };
  };
  const job = {
    schema: 1,
    id,
    nonce,
    platform: 'darwin',
    oldPid: process.ppid,
    oldVersion: '0.2.0-alpha.91',
    version,
    target,
    stage,
    userData: data,
    oldIdentity: fileIdentity(previous),
    newIdentity: fileIdentity(target),
    limits: { exitMs: 120000, healthMs: 90000, abortMs: 30000 },
  };
  fs.mkdirSync(join(data, 'updates/transactions'), { recursive: true });
  fs.writeFileSync(join(data, 'updates/transactions', id + '.json'), JSON.stringify(job));
  fs.writeFileSync(join(data, 'updates/active.json'), JSON.stringify({ id, target }));
  fs.writeFileSync(
    join(data, 'updates/view.json'),
    JSON.stringify({
      schema: 1,
      from: job.oldVersion,
      to: version,
      folder: studio,
      view: { page: 'agents' },
    }),
  );
  process.execPath = executable;
  process.argv.push('--pistudio-update=' + id, '--pistudio-user-data=' + data);
  let releaseMetadata;
  const metadataGate = new Promise((done) => {
    releaseMetadata = done;
  });
  let window,
    metadataReleased = false,
    blockedReads = 0,
    forbidden = 0;
  const requests = [];
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    originalHandle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA: no Pi/model calls' })
        : name === 'studio:launch-agent' || name === 'studio:setup-assistant'
          ? () => {
              forbidden++;
              throw Error('QA forbids launch');
            }
          : name === 'studio:update-readiness'
            ? (event, value) => {
                requests.push(value);
                return action(event, value);
              }
            : action,
    );
  const entry = fs.realpathSync(
    process.env.PI_STUDIO_BOOT_QA_ENTRY || resolve('out/main/index.cjs'),
  );
  const originalLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'node:fs/promises' && parent?.filename === entry)
      return new Proxy(originalPromises, {
        get(target, key) {
          return key === 'open'
            ? async (path, ...args) => {
                if (path === preferences && !metadataReleased) {
                  blockedReads++;
                  await metadataGate;
                }
                return originalPromises.open(path, ...args);
              }
            : Reflect.get(target, key);
        },
      });
    return originalLoad.call(this, id, parent, isMain);
  };
  const proxyApp = new Proxy(app, {
    get(target, key) {
      if (key === 'isPackaged') return true;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const proxyDialog = new Proxy(dialog, {
    get(target, key) {
      if (String(key).startsWith('show'))
        return () => {
          forbidden++;
          throw Error('QA forbids native dialogs');
        };
      return Reflect.get(target, key);
    },
  });
  app.once('browser-window-created', (_event, created) => {
    window = created;
    assert.equal(metadataReleased, false, 'Window must precede the stalled studio read');
  });
  let success = false;
  const deadline = setTimeout(() => {
    console.error('Update boot regression timed out');
    app.exit(1);
  }, 18000);
  app.on('quit', () => {
    if (!success) return;
    fs.writeFileSync(
      join(root, 'proof.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        realCompiledMainPreloadRenderer: true,
        syntheticPrivatePathBoundTransaction: true,
        windowCreatedBeforeStudioMetadataRead: true,
        offscreenWithoutFocus: true,
        noHealthBeforeMetadataHydration: true,
        savedAgentsViewRestored: true,
        realStartupHealthAcknowledgement: true,
        authenticatedAbortClosesDespiteBeforeUnload: true,
        noForcedExit: true,
        forbiddenLaunchesAndDialogs: forbidden,
        userAppOrDataChanged: false,
      }),
    );
  });
  const until = async (read) => {
    const end = Date.now() + 7000;
    while (Date.now() < end) {
      if (await read()) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw Error('Update boot condition timed out');
  };
  (async () => {
    try {
      qa.loadOffscreenMain(entry, { app: proxyApp, dialog: proxyDialog });
    } finally {
      Module._load = originalLoad;
    }
    if (process.env.PI_STUDIO_BOOT_EXPECT_BLOCKED) {
      await until(() => blockedReads > 0);
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(
        window,
        undefined,
        'The previous release blocks window creation behind metadata',
      );
      fs.writeFileSync(
        join(root, 'proof.json'),
        JSON.stringify({
          checkedAt: new Date().toISOString(),
          previousVersion: version,
          publishedMainReproducesInvisibleStartupWhileMetadataIsPending: true,
          userAppOrDataChanged: false,
          ownedFixtureExitUsedToStopBlockedCase: true,
        }),
      );
      clearTimeout(deadline);
      app.exit(0);
      return;
    }
    await until(() => !!window && blockedReads > 0);
    await until(() => window.webContents.executeJavaScript(`document.body.innerText.length>0`));
    assert.equal(window.isVisible(), false);
    const before = await window.webContents.executeJavaScript(`window.studio.getUpdateState()`);
    assert.equal(before.startup.initialized, false);
    assert.equal(fs.existsSync(join(stage, 'health.json')), false);
    metadataReleased = true;
    releaseMetadata();
    await until(() => fs.existsSync(join(stage, 'health.json')));
    const text = await window.webContents.executeJavaScript(`document.body.innerText`);
    assert(/мои команды|my teams/i.test(text), text);
    assert(requests.some((r) => r.saved && r.hydrated));
    assert.equal(JSON.parse(fs.readFileSync(join(stage, 'health.json'), 'utf8')).pid, process.pid);
    await window.webContents.executeJavaScript(
      `window.addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='';}); true`,
    );
    success = true;
    clearTimeout(deadline);
    setTimeout(() => {
      console.error('Abort could not close the owned replacement');
      app.exit(1);
    }, 5000).unref();
    const { atomicJson } = await import(
      pathToFileURL(resolve('bundled/update-helper/protocol.mjs')).href
    );
    await atomicJson(join(stage, 'abort-startup.json'), { nonce });
  })().catch((e) => {
    console.error(e);
    clearTimeout(deadline);
    app.exit(1);
  });
}
