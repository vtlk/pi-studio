const assert = require('node:assert/strict');
const { mkdtemp, mkdir, realpath, readFile, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-helper-launch-')));
  try {
    await mkdir(join(root, 'UserData'));
    await mkdir(join(root, 'Videos'));
    await new Promise((done, fail) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (b) => {
        log += b;
      });
      child.stderr.on('data', (b) => {
        log += b;
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), 65000);
      child.once('error', fail);
      child.once('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? done() : fail(Error(log));
      });
    });
    const proof = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/helper-launch-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function child() {
  const { app, ipcMain, dialog } = require('electron');
  const root = process.argv[3];
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  app.getPreferredSystemLanguages = () => ['ru-RU'];
  dialog.showMessageBox = dialog.showMessageBoxSync = () => {
    throw Error('No native dialogs in helper UI QA');
  };
  let calls = 0,
    pending;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
      : channel === 'studio:setup-assistant'
          ? () => {
              calls++;
              return new Promise((resolve, reject) => {
                pending = { resolve, reject };
              });
            }
          : channel === 'studio:connection-status'
            ? () => ({ status: 'ready', connectionId: 'qa-helper' })
            : action,
    );
  const deadline = setTimeout(() => app.exit(1), 60000);
  try {
    const loaded = new Promise((done) =>
      app.once('browser-window-created', (_, w) => {
        w.webContents.setAudioMuted(true);
        w.webContents.once('did-finish-load', () => done(w));
      }),
    );
    require('./offscreen-main.cjs').loadOffscreenMain();
    const w = await loaded;
    w.webContents.removeAllListeners('will-prevent-unload');
    w.webContents.on('will-prevent-unload', () => app.exit(1));
    const js = (code) => w.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw Error(
        'Helper UI condition: ' + code + '\n' + (await js('document.body.innerText.slice(-1500)')),
      );
    };
    const click = (text) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    const idle = () =>
      until(
        `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
      );
    const labels = JSON.parse(await readFile('src/shared/i18n/ru.json', 'utf8'));
    await idle();
    await click(labels['Topbar.agents']);
    await until(`!!document.querySelector('.agent-helper-launch')`);
    await js(`document.querySelector('.agent-helper-launch').click()`);
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.equal(calls, 0, 'Missing model opens preflight, never Pi');
    assert.ok((await js('document.body.innerText')).toLowerCase().includes('подключен'));
    await click(labels['TeamNameDialog.cancel']);
    const state = await js('window.studio.loadStudio()');
    const connections = [
      {
        id: 'qa-helper',
        name: 'QA',
        purpose: 'codex',
        providerId: 'openai-codex',
        endpoint: '',
        account: '',
        createdAt: 1,
      },
    ];
    const agents = state.sections.systemAgents.map((a) => ({
      ...a,
      model: {
        connectionId: 'qa-helper',
        provider: 'openai-codex',
        id: 'qa-model',
        reasoning: 'Средний',
        temperature: '',
      },
    }));
    await js(
      `window.studio.saveSection('connections',${JSON.stringify(connections)},${JSON.stringify({ folder: state.folder, base: state.sections.connections })})`,
    );
    await js(
      `window.studio.saveSection('systemAgents',${JSON.stringify(agents)},${JSON.stringify({ folder: state.folder, base: state.sections.systemAgents })})`,
    );
    const reloaded = new Promise((done) => w.webContents.once('did-finish-load', done));
    w.webContents.reload();
    await reloaded;
    await idle();
    await click(labels['Topbar.agents']);
    await until(`!!document.querySelector('.agent-helper-launch')`);
    await js(
      `(()=>{const b=document.querySelector('.agent-helper-launch');b.click();b.click();})()`,
    );
    await until(
      `document.querySelector('.agent-helper-launch')?.getAttribute('aria-busy')==='true'`,
    );
    for (let i = 0; !pending && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(pending);
    assert.equal(calls, 1);
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.agent-helper-launch')).opacity`),
      '1',
    );
    assert.ok(await js(`!!document.querySelector('.agent-helper-launch .project-launch-spinner')`));
    pending.reject(Error('QA: Windows Terminal failed to open'));
    pending = undefined;
    await until(
      `document.querySelector('[role="alertdialog"]')?.textContent.includes('QA: Windows Terminal failed to open')`,
    );
    assert.equal(
      await js(
        `document.querySelector('[role="alertdialog"]').textContent.includes('Error invoking remote method')`,
      ),
      false,
    );
    await new Promise((r) => setTimeout(r, 4700));
    assert.ok(
      await js(`!!document.querySelector('[role="alertdialog"]')`),
      'Error must not disappear as a toast',
    );
    await click(labels['Modal.closeWindow']);
    await js(`document.querySelector('.agent-helper-launch').click()`);
    for (let i = 0; !pending && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(calls, 2);
    pending.resolve();
    pending = undefined;
    await until(`!document.querySelector('.agent-helper-launch')?.hasAttribute('aria-busy')`);
    assert.equal(await js(`!!document.querySelector('[role="alertdialog"]')`), false);
    await js(`document.querySelector('.settings-button').click()`);
    await click(labels['SettingsView.connectionAssistant']);
    await click(labels['SetupAssistantAction.openAssistantInPi']);
    for (let i = 0; !pending && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(calls, 3);
    pending.reject(Error('QA: settings entry failure'));
    pending = undefined;
    await until(
      `document.querySelector('[role="alertdialog"]')?.textContent.includes('QA: settings entry failure')`,
    );
    await click(labels['Modal.closeWindow']);
    await idle();
    const proof = {
      checkedAt: new Date().toISOString(),
      missingModelPreflightBeforeIpc: true,
      duplicateClicksBlocked: true,
      busyIconVisibleWithoutHover: true,
      errorPersistsUntilDismissed: true,
      rawIpcPrefixRemoved: true,
      successfulRetryRestoresPlay: true,
      settingsEntryUsesSameErrorModal: true,
      explicitStubbedIpcCalls: calls,
      realModelOrTerminalLaunches: 0,
      nativeWindowsUiAcceptance: false,
      userAppOrDataChanged: false,
    };
    await writeFile(join(root, 'proof.json'), JSON.stringify(proof));
    w.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
