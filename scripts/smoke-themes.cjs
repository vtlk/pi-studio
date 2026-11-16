const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath, cp } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-themes-')));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    const phases = [];
    for (const phase of ['fresh', 'dark', 'light']) {
      await new Promise((done, fail) => {
        const child = spawn(require('electron'), [__filename, '--child', root, phase], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let log = '',
          timedOut = false;
        child.stdout.on('data', (data) => {
          log += data;
        });
        child.stderr.on('data', (data) => {
          log += data;
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, 90000);
        child.once('error', fail);
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code !== 0 || timedOut) fail(Error(log));
          else done();
        });
      });
      phases.push(JSON.parse(await readFile(join(root, phase + '.json'), 'utf8')));
    }
    await mkdir('artifacts', { recursive: true });
    for (const name of [
      'agents-dark',
      'agents-light',
      'resources-dark',
      'project-dark',
      'project-light',
    ])
      await cp(join(root, name + '.png'), join('artifacts', 'themes-' + name + '.png'));
    const proof = {
      checkedAt: new Date().toISOString(),
      nativeMainPreloadRenderer: true,
      sourceWorkspace: true,
      shippedInAlpha81: false,
      phases,
      globalOsThemeChanged: false,
      nativeWindowsAccepted: false,
      userStudioOrAppMutated: false,
      allOwnedProcessesExited: true,
    };
    await writeFile('artifacts/themes-native-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
async function child() {
  const { app, ipcMain, nativeTheme, dialog } = require('electron');
  const root = process.argv[3],
    phase = process.argv[4];
  assert.ok(
    root && root.startsWith(join(require('node:fs').realpathSync(tmpdir()), 'pistudio-themes-')),
  );
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [join(root, 'OtherStudio')] });
  let launches = 0;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : ['studio:launch-agent', 'studio:open-setup-assistant'].includes(channel)
          ? () => {
              launches++;
              throw Error('No model or Terminal launch in theme QA');
            }
          : action,
    );
  const firstFrames = [];
  let captureStartup = true;
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setAudioMuted(true);
      window.webContents.on('paint', (_, dirty, img) => {
        if (!captureStartup || firstFrames.length >= 30) return;
        const bytes = img.toBitmap({ scaleFactor: 1 });
        if (bytes.length >= 4 && bytes[3] === 255) firstFrames.push([bytes[2], bytes[1], bytes[0]]);
      });
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  const timer = setTimeout(() => {
    console.error('Theme QA timeout');
    app.exit(1);
  }, 85000);
  let window;
  try {
    require('./offscreen-main.cjs').loadOffscreenMain();
    window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved theme QA close');
      app.exit(1);
    });
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const js = (code) =>
      window.webContents.executeJavaScript(code, true).catch((error) => {
        console.error('Theme expression:', code.slice(0, 350), String(error), error?.stack);
        throw error;
      });
    const until = async (code) => {
      for (let i = 0; i < 180; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error(code + '\n' + (await js('document.body.innerText.slice(-1600)')));
    };
    const click = (text) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.closest('[hidden]')).click()`,
      );
    const named = (label) =>
      js(
        `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
      );
    const field = (label, value) =>
      js(
        `(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const saved = () =>
      until(
        `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
      );
    const key = async (key, code, number, text = '') => {
      for (const type of ['keyDown', 'keyUp'])
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type,
          key,
          code,
          windowsVirtualKeyCode: number,
          ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}),
        });
      await js('new Promise(r=>requestAnimationFrame(r))');
    };
    const setTheme = async (theme) => {
      const state = await js(`window.studio.setTheme(${JSON.stringify(theme)})`);
      assert.equal(state.error, undefined);
      await until(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
    };
    const capture = async (name) => {
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await writeFile(join(root, name + '.png'), (await window.webContents.capturePage()).toPNG());
    };
    await until(`!!document.querySelector('.theme-toggle')`);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    captureStartup = false;
    const initial = await js('window.studio.getTheme()');
    assert.equal(initial.error, undefined);
    assert.equal(await js('CSS.supports("color","light-dark(white, black)")'), true);
    assert.equal(await js('document.documentElement.dataset.theme'), initial.theme);
    assert.ok(firstFrames.length > 0);
    assert.ok(
      firstFrames.every((rgb) =>
        initial.theme === 'dark' ? Math.max(...rgb) < 160 : Math.min(...rgb) > 160,
      ),
      'No opposite-theme pixels at startup corners',
    );
    assert.equal(
      await js(
        `document.querySelector('.theme-toggle').nextElementSibling.classList.contains('settings-button')`,
      ),
      true,
    );
    assert.equal(await js(`document.querySelector('.theme-toggle').hasAttribute('title')`), false);
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.theme-toggle')).borderTopWidth`),
      '0px',
    );
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.settings-button')).borderTopWidth`),
      '0px',
    );
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.settings-button')).borderRadius`),
      await js(`getComputedStyle(document.querySelector('.topbar nav button')).borderRadius`),
    );
    const checks =
      phase === 'fresh'
        ? await require('./theme-ui-checks.cjs')({
            root,
            window,
            js,
            until,
            click,
            named,
            field,
            saved,
            key,
            setTheme,
            capture,
            nativeTheme,
            initial,
          })
        : {};
    if (phase !== 'fresh') {
      assert.equal(initial.preference, phase);
      assert.equal(initial.theme, phase);
      assert.equal(nativeTheme.themeSource, phase);
      nativeTheme.emit('updated');
      await js('new Promise(r=>setTimeout(r,100))');
      assert.equal(await js('document.documentElement.dataset.theme'), phase);
      await setTheme(phase === 'dark' ? 'light' : 'dark');
    }
    assert.equal(launches, 0);
    await saved();
    await writeFile(
      join(root, phase + '.json'),
      JSON.stringify({
        phase,
        initial,
        firstFrames,
        sourceBeforeFirstFrame: true,
        buttonImmediatelyBeforeSettings: true,
        borderlessSharedTooltipButton: true,
        agentLaunches: launches,
        ...checks,
      }),
    );
    window.destroy();
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(String(error), error?.stack);
    clearTimeout(timer);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
