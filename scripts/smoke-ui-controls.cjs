const assert = require('node:assert/strict');
const { mkdtemp, mkdir, realpath, readFile, writeFile, rm, cp } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-ui-controls-')));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    await new Promise((done, fail) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '',
        timedOut = false;
      child.stdout.on('data', (b) => (log += b));
      child.stderr.on('data', (b) => (log += b));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, 95000);
      child.once('error', fail);
      child.once('close', (code) => {
        clearTimeout(timer);
        code || timedOut ? fail(Error(log)) : done();
      });
    });
    await mkdir('artifacts', { recursive: true });
    for (const file of [
      'ui-controls-proof.json',
      'ui-controls-provider.png',
      'ui-controls-project.png',
    ])
      await cp(join(root, file), join('artifacts', file));
    console.log('UI-24–26 native controls passed');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
async function child() {
  const { app, ipcMain } = require('electron');
  const root = process.argv[3];
  assert.ok(
    root.startsWith(join(require('node:fs').realpathSync(tmpdir()), 'pistudio-ui-controls-')),
  );
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  let authRequests = 0,
    launches = 0,
    catalogGate,
    releaseCatalog;
  const providers = Array.from({ length: 35 }, (_, i) => ({
    id: 'qa-provider-' + i,
    name: i === 17 ? 'Зелёный поставщик' : 'Provider ' + i,
    configured: false,
    subscription: false,
    isolatedAuth: true,
    loginMethods: [],
  }));
  let available = providers;
  const holdCatalog = () => {
    catalogGate = new Promise((r) => (releaseCatalog = r));
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : channel === 'studio:model-catalog'
          ? async () => {
              if (catalogGate) await catalogGate;
              return { providers: available, models: [] };
            }
          : ['studio:provider-status', 'studio:connection-status'].includes(channel)
            ? (_, request) => ({
                connectionId: request?.connectionId,
                provider: 'qa-provider-17',
                status: 'not_ready',
              })
            : [
                  'studio:connection-login',
                  'studio:provider-login',
                  'studio:codex-login',
                  'studio:claude-code',
                ].includes(channel)
              ? () => {
                  authRequests++;
                  throw Error('Theme/control QA never authorizes accounts');
                }
              : ['studio:launch-agent', 'studio:setup-assistant'].includes(channel)
                ? () => {
                    launches++;
                    throw Error('No Pi/model launch in control QA');
                  }
                : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setAudioMuted(true);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  const deadline = setTimeout(() => {
    console.error('Controls timeout');
    app.exit(1);
  }, 90000);
  let window;
  try {
    require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
    window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved QA reload');
      app.exit(1);
    });
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const js = (code) =>
      window.webContents.executeJavaScript(code, true).catch((e) => {
        console.error(code.slice(0, 240), String(e));
        throw e;
      });
    const until = async (code) => {
      for (let i = 0; i < 170; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error(code + '\n' + (await js('document.body.innerText.slice(-1200)')));
    };
    const click = (text) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    const named = (label) =>
      js(
        `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
      );
    const field = (selector, value) =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
    const saved = () =>
      until(
        `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
      );
    const theme = async (value) => {
      await js(`window.studio.setTheme(${JSON.stringify(value)})`);
      await until(`document.documentElement.dataset.theme===${JSON.stringify(value)}`);
    };
    const capture = async (name) =>
      writeFile(join(root, name), (await window.webContents.capturePage()).toPNG());
    const select = async (label, text) => {
      await js(
        `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').focus()`,
      );
      await key('ArrowDown', 'ArrowDown', 40);
      await until(`!!document.querySelector('[role="option"]')`);
      await js(
        `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)}).focus()`,
      );
      await key('Enter', 'Enter', 13, '\r');
      await until(`!document.querySelector('[role="listbox"]')`);
    };
    const proof = await require('./ui-controls-checks.cjs')({
      root,
      window,
      js,
      until,
      click,
      named,
      field,
      key,
      saved,
      theme,
      capture,
      select,
      holdCatalog,
      release: () => {
        releaseCatalog();
        catalogGate = undefined;
      },
      providers,
      setProviders: (value) => (available = value),
    });
    assert.equal(authRequests, 0);
    assert.equal(launches, 0);
    await saved();
    await writeFile(
      join(root, 'ui-controls-proof.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          actualNativeMainPreloadRenderer: true,
          fixtureProviderCatalog: true,
          productionCredentialsAccessed: false,
          authRequests,
          modelOrTerminalRequests: launches,
          globalOsThemeChanged: false,
          installedAppOrUserStudioChanged: false,
          ...proof,
        },
        null,
        2,
      ) + '\n',
    );
    window.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(String(error), error?.stack);
    clearTimeout(deadline);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
