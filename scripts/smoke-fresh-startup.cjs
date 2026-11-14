const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir, homedir } = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

// Two separate native processes use the actual packaged main/preload/renderer and installer.
// Only BrowserWindow presentation is offscreen. No startup/IPC/probe/install fixtures.
async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-fresh-startup-')));
  const application = resolve(
    process.argv[2] || join(homedir(), 'Applications/Pi Studio.app/Contents/Resources/app'),
  );
  const entry = join(application, 'out/main/index.cjs');
  const metadata = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
  const current = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  assert.equal(metadata.version, current.version, 'Test the current packaged application');
  const digest = async (path) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const entryHash = await digest(entry);
  const electron = require('electron');
  const run = (phase) =>
    new Promise((resolveRun, reject) => {
      const child = spawn(electron, [__filename, '--child', root, application, phase], {
        env: { ...process.env, HOME: root, PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data;
        process.stdout.write(data);
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), 300_000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(new Error(`Fresh startup ${phase} failed (${code}): ${stderr}\n${stdout}`));
        else resolveRun();
      });
    });
  try {
    for (const directory of ['Videos', 'UserData', 'Documents']) await mkdir(join(root, directory));
    await run('install');
    await run('reuse');
    assert.equal(await digest(entry), entryHash, 'Packaged application was not modified');
    const proof = {
      version: metadata.version,
      verifiedAt: new Date().toISOString(),
      packagedMainSha256: entryHash,
      first: JSON.parse(await readFile(join(root, 'install.json'), 'utf8')),
      second: JSON.parse(await readFile(join(root, 'reuse.json'), 'utf8')),
      scope:
        'Actual packaged main/preload/renderer and real pinned runtime download/install; offscreen presentation only. Separate process reuse with Node fetch denied. No credentials, Terminal or model calls; isolated HOME/workspace/userData removed.',
    };
    await mkdir(resolve('artifacts'), { recursive: true });
    await writeFile(
      resolve('artifacts/fresh-startup-proof.json'),
      JSON.stringify(proof, null, 2) + '\n',
    );
    console.log(
      'Fresh packaged startup passed: real download/install, empty studio, separate offline reuse.',
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron');
  const [, , , root, application, phase] = process.argv;
  assert.equal(homedir(), root, 'Do not discover the user Pi or access their home');
  const requests = [],
    phases = [];
  const fetchNative = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push(new URL(String(url)).origin);
    if (phase === 'reuse') throw new Error('No download allowed during managed runtime reuse');
    return fetchNative(url, options);
  };
  for (const [key, directory] of [
    ['videos', 'Videos'],
    ['documents', 'Documents'],
    ['userData', 'UserData'],
  ])
    app.setPath(key, join(root, directory));
  let window;
  const deadline = setTimeout(() => {
    console.error('Fresh startup timed out');
    app.exit(1);
  }, 280_000);
  try {
    const loaded = new Promise((resolveWindow) =>
      app.once('browser-window-created', (_, created) => {
        created.webContents.setBackgroundThrottling(false);
        created.hide();
        created.on('show', () => created.hide());
        created.webContents.once('did-finish-load', () => resolveWindow(created));
      }),
    );
    require('./offscreen-main.cjs').loadOffscreenMain(join(application, 'out/main/index.cjs'));
    window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('QA shutdown before saved');
      app.exit(1);
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 4000; i++) {
        if (await js(code)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 60));
      }
      throw new Error('Timed out: ' + code);
    };
    let state,
      progressVisible = false,
      iconDecoded = false;
    while (true) {
      state = await js('window.studio.getStartup()');
      if (!phases.includes(state.phase)) {
        phases.push(state.phase);
        console.log(`${phase}: ${state.phase}`);
      }
      if (['downloading', 'installing', 'verifying'].includes(state.phase)) {
        progressVisible ||= await js(`!!document.querySelector('[role="progressbar"]')`);
        iconDecoded ||= await js(`!!document.querySelector('.startup-icon')?.naturalWidth`);
      }
      if (state.phase === 'error') throw new Error(state.message);
      if (state.phase === 'ready') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 60));
    }
    assert.equal(state.pi.version, '1.5.2');
    assert.equal(state.pi.nativeMcp && state.pi.exactSessions && state.pi.supported, true);
    assert.equal(state.pi.path, join(root, 'UserData/runtime/pi/bin/pi'));
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
    await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
    const data = await js('window.studio.loadStudio()');
    assert.equal(data.folder, join(root, 'Videos/Pi Studio'));
    for (const name of ['agents', 'connections', 'resources'])
      assert.deepEqual(data.sections[name], []);
    assert.deepEqual(data.projects, []);
    assert.deepEqual((await js('window.studio.listLibrary()')).assets, []);
    assert.equal(data.sections.systemAgents.length, 1);
    assert.equal(data.sections.systemAgents[0].systemRole, 'assistant');
    assert.equal(
      (await js('window.studio.getInfo()')).version,
      JSON.parse(await readFile(join(application, 'package.json'), 'utf8')).version,
    );
    if (phase === 'install') {
      assert.ok(phases.includes('downloading') && phases.includes('installing'));
      assert.ok(
        progressVisible && iconDecoded,
        'Actual install has visible progress and decoded icon',
      );
      assert.deepEqual(requests, ['https://nodejs.org']);
      await mkdir(resolve('artifacts'), { recursive: true });
      await writeFile(
        resolve('artifacts/fresh-startup-empty.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    } else {
      assert.deepEqual(requests, []);
      assert.equal(
        phases.some((phase) => ['downloading', 'installing', 'verifying'].includes(phase)),
        false,
      );
    }
    const runtime = join(root, 'UserData/runtime');
    assert.equal(
      (await readdir(runtime)).some((name) => name.startsWith('.pi-install-')),
      false,
    );
    const lock = await readFile(join(runtime, 'pi/package/package-lock.json'));
    const studioFile = await readFile(join(data.folder, '.pistudio/studio.json'));
    const report = {
      phases,
      progressVisible,
      iconDecoded,
      nodeFetchOrigins: requests,
      pi: {
        version: state.pi.version,
        supported: state.pi.supported,
        nativeMcp: state.pi.nativeMcp,
        exactSessions: state.pi.exactSessions,
      },
      emptyStudio: true,
      onlySystemHelper: true,
      stagingCleaned: true,
      runtimeLockSha256: createHash('sha256').update(lock).digest('hex'),
      studioSha256: createHash('sha256').update(studioFile).digest('hex'),
    };
    if (phase === 'reuse') {
      const first = JSON.parse(await readFile(join(root, 'install.json'), 'utf8'));
      assert.equal(report.studioSha256, first.studioSha256, 'Restart preserves studio bytes');
      assert.equal(report.runtimeLockSha256, first.runtimeLockSha256);
    }
    await writeFile(join(root, `${phase}.json`), JSON.stringify(report));
    clearTimeout(deadline);
    for (const created of BrowserWindow.getAllWindows()) created.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
}

(process.versions.electron ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
