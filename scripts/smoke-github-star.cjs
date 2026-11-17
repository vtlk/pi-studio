const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const interval = 3 * 60 * 60_000;
async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-star-ui-')));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    await writeFile(join(root, 'UserData', 'language.json'), JSON.stringify({ language: 'ru' }));
    await writeFile(
      join(root, 'UserData', 'github-star.json'),
      JSON.stringify({ schema: 1, elapsedMs: interval, disabled: false }),
    );
    const run = (phase) =>
      new Promise((done, fail) => {
        const child = spawn(require('electron'), [__filename, '--child', root, phase], {
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
        const timeout = setTimeout(() => child.kill('SIGTERM'), 90000);
        child.once('error', fail);
        child.once('exit', (code) => {
          clearTimeout(timeout);
          code === 0 ? done() : fail(Error(log));
        });
      });
    await run('ui');
    await writeFile(
      join(root, 'UserData', 'github-star.json'),
      JSON.stringify({ schema: 1, elapsedMs: interval, disabled: false }),
    );
    await run('open');
    await run('disabled');
    const proof = {
      phases: await Promise.all(
        ['ui', 'open', 'disabled'].map(async (phase) =>
          JSON.parse(await readFile(join(root, phase + '.json'), 'utf8')),
        ),
      ),
    };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/github-star-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function child() {
  const { app, ipcMain, shell } = require('electron');
  const root = process.argv[3],
    phase = process.argv[4];
  assert.ok(root.startsWith(join(require('node:fs').realpathSync(tmpdir()), 'pistudio-star-ui-')));
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  const opened = [];
  shell.openExternal = async (url) => {
    opened.push(url);
    throw Error('Isolated opener failure');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  let getState;
  ipcMain.handle = (channel, action) => {
    if (channel === 'studio:github-star-state') getState = action;
    handle(
      channel,
      channel === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action,
    );
  };
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setAudioMuted(true);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  const timeout = setTimeout(() => {
    console.error('Star UI timeout');
    app.exit(1);
  }, 85000);
  try {
    require('./offscreen-main.cjs').loadOffscreenMain();
    const window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved QA state');
      app.exit(1);
    });
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 160; i++) {
        if (await js(code)) return;
        await new Promise((done) => setTimeout(done, 30));
      }
      throw Error(code + '\n' + (await js('document.body.innerText.slice(-1200)')));
    };
    const reminder = `document.querySelector('[aria-label="Пожалуйста, поставьте нам звёздочку на GitHub"]') || document.querySelector('[aria-label="Please give us a star on GitHub"]')`;
    await until('!!window.studio && !!document.querySelector(".app-shell")');
    const initial = await js('window.studio.getGitHubStar()');
    if (phase === 'disabled') {
      assert.equal(initial.disabled, true);
      assert.equal(initial.due, false);
      assert.equal(await js(`!!(${reminder})`), false);
      assert.equal(opened.length, 0);
      await writeFile(
        join(root, phase + '.json'),
        JSON.stringify({ phase, permanentOptOutAfterRestart: true, openerCalls: 0 }),
      );
      clearTimeout(timeout);
      window.destroy();
      app.exit(0);
      return;
    }
    assert.equal(initial.due, true);
    if (phase === 'open') {
      await js(
        `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}); void 0;`,
      );
      window.webContents.send('studio:github-star-changed', { ...initial, canPresent: true });
      await until(`!!(${reminder})`);
      await js(`(${reminder}).querySelectorAll('button')[1].click()`);
      await until('(async()=>(await window.studio.getGitHubStar()).disabled)()');
      await until('document.body.textContent.includes("Reminders are disabled")');
      assert.deepEqual(opened, ['https://github.com/vtlk/pi-studio']);
      assert.equal(
        JSON.parse(await readFile(join(root, 'UserData', 'github-star.json'), 'utf8')).disabled,
        true,
      );
      assert.equal(await js(`!!(${reminder})`), false);
      await writeFile(
        join(root, phase + '.json'),
        JSON.stringify({
          phase,
          fixedUrlOpenerOnce: true,
          openerFailureKeepsDisabled: true,
          persistedOptOut: true,
        }),
      );
      clearTimeout(timeout);
      window.destroy();
      app.exit(0);
      return;
    }
    assert.equal(initial.canPresent, false); // Real hidden offscreen window is ineligible.
    assert.equal(await js(`!!(${reminder})`), false);
    // Exercise the actual main controller and preload with native event/state inputs.
    // Override queries only: never raise, minimize or focus an OS window during QA.
    await js(
      `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}); void 0;`,
    );
    let presentation = { visible: true, focused: true, minimized: false, enabled: true };
    const original = {
      isVisible: window.isVisible.bind(window),
      isFocused: window.isFocused.bind(window),
      isMinimized: window.isMinimized.bind(window),
      isEnabled: window.isEnabled.bind(window),
    };
    window.isVisible = () => presentation.visible;
    window.isFocused = () => presentation.focused;
    window.isMinimized = () => presentation.minimized;
    window.isEnabled = () => presentation.enabled;
    let unwantedWindowActivations = 0;
    window.show = window.focus = () => {
      unwantedWindowActivations++;
    };
    const controllerCases = [];
    for (const [event, patch, expected] of [
      ['focus', {}, true],
      ['blur', { focused: false }, false],
      ['focus', { focused: true }, true],
      ['minimize', { minimized: true }, false],
      ['restore', { minimized: false }, true],
      ['hide', { visible: false }, false],
      ['show', { visible: true }, true],
      ['blur', { enabled: false }, false],
      ['focus', { enabled: true }, true],
    ]) {
      presentation = { ...presentation, ...patch };
      window.emit(event);
      const status = await js('window.studio.getGitHubStar()');
      assert.equal(status.canPresent, expected, event);
      controllerCases.push({ event, canPresent: status.canPresent });
    }
    for (const [event, expected] of [
      ['sheet-begin', false],
      ['sheet-begin', false],
      ['sheet-end', false],
      ['sheet-end', true],
    ]) {
      window.emit(event);
      assert.equal((await js('window.studio.getGitHubStar()')).canPresent, expected, event);
      controllerCases.push({ event, canPresent: expected });
    }
    assert.equal(await js(`!!(${reminder})`), false);
    assert.equal(unwantedWindowActivations, 0);
    Object.assign(window, original);
    window.emit('hide');
    await js(
      `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}); window.qaReturn=document.querySelector('.topbar button') || document.querySelector('button'); window.qaReturn.focus(); const blocker=document.createElement('section'); blocker.id='qa-other-modal'; blocker.setAttribute('aria-modal','true'); document.body.append(blocker);`,
    );
    // Only presentation eligibility is simulated; storage, preload, choice handler and Modal are real.
    const send = async () => {
      const status = await getState({
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      });
      window.webContents.send('studio:github-star-changed', { ...status, canPresent: true });
    };
    await send();
    await js('new Promise(r=>setTimeout(r,120))');
    assert.equal(await js(`!!(${reminder})`), false);
    await js('document.getElementById("qa-other-modal").remove()');
    await until(`!!(${reminder})`);
    assert.deepEqual(
      await js(`Array.from((${reminder}).querySelectorAll('button')).map(x=>x.textContent)`),
      ['Позже', 'Открыть GitHub'],
    );
    assert.equal(
      await js(`(${reminder}).textContent.includes('https://github.com/vtlk/pi-studio')`),
      true,
    );
    // Focus trap and Escape go through the shared Modal keyboard handlers.
    await js(`(${reminder}).querySelectorAll('button')[1].focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await until(`document.activeElement === (${reminder}).querySelector('button')`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(`!(${reminder})`);
    await until('document.activeElement === window.qaReturn');
    await until('(async()=>!(await window.studio.getGitHubStar()).due)()');
    assert.equal(opened.length, 0);
    let saved;
    for (let i = 0; i < 100; i++) {
      saved = JSON.parse(await readFile(join(root, 'UserData', 'github-star.json'), 'utf8'));
      if (saved.elapsedMs < 1000) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.ok(saved.elapsedMs < 1000);
    assert.equal(saved.disabled, false);
    // Simulate the next main-clock threshold without changing production timing.
    window.webContents.send('studio:github-star-changed', {
      due: true,
      disabled: false,
      revision: 100,
      canPresent: true,
    });
    await until(`!!(${reminder})`);
    await js("window.studio.setLanguage('en')");
    await until(`!!document.querySelector('[aria-label="Please give us a star on GitHub"]')`);
    assert.deepEqual(
      await js(`Array.from((${reminder}).querySelectorAll('button')).map(x=>x.textContent)`),
      ['Later', 'Open GitHub'],
    );
    await js("window.studio.setTheme('dark')");
    await until('document.documentElement.dataset.theme === "dark"');
    await js("window.studio.setTheme('light')");
    await until('document.documentElement.dataset.theme === "light"');
    await js(`(${reminder}).querySelector('button').click()`);
    await until(`!(${reminder})`);
    await writeFile(
      join(root, phase + '.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        hiddenMainWindowIneligible: true,
        presentationEligibilitySimulated: true,
        otherModalDeferred: true,
        exactlyTwoButtons: true,
        russianAndEnglish: true,
        darkAndLight: true,
        keyboardFocusTrap: true,
        escapeMeansLater: true,
        focusReturned: true,
        realPreferencesAndPreload: true,
        mainControllerCases: controllerCases,
        nativeStateQueriesSimulatedWithoutOsActions: true,
        unwantedWindowActivations,
        openerCalls: opened.length,
        physicalMacAcceptance: false,
        windowsAcceptance: false,
        userDataUntouched: true,
      }),
    );
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(phase, error.stack);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
