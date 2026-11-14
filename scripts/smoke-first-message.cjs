const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, readFile, access } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary;
const launches = [],
  choices = [],
  releases = [];
let selection = [];
let delayedPicker = false,
  finishPicker,
  pickerReady;
const deadline = setTimeout(() => {
  console.error('First-message QA timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-first-message-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData');
  mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const account = {
    id: 'qa-account',
    name: 'QA account',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  const profile = {
    id: 'qa-agent',
    name: 'QA agent',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      connectionId: account.id,
      provider: account.providerId,
      id: 'qa-model',
      reasoning: 'Средний',
      temperature: '',
    },
  };
  const projectDir = join(studio, 'projects', 'attachment-check');
  mkdirSync(join(projectDir, 'agents/qa/output'), { recursive: true });
  mkdirSync(join(projectDir, 'agents/qa/sessions'), { recursive: true });
  const projectFile = join(projectDir, 'project.json');
  const { instructions, ...snapshot } = profile;
  writeFileSync(
    projectFile,
    JSON.stringify({
      schemaVersion: 1,
      id: 'qa-project',
      name: 'Attachment check',
      createdAt: 1,
      agents: [{ profile: snapshot, outputPath: 'agents/qa/output' }],
    }),
  );
  mkdirSync(join(studio, '.pistudio'), { recursive: true });
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { agents: [profile], connections: [account] } }),
  );
  const inputs = join(temporary, 'Inputs');
  mkdirSync(inputs);
  const batch = Array.from({ length: 32 }, (_, i) => {
    const path = join(inputs, `reference-${i}.txt`);
    writeFileSync(path, `reference ${i}`);
    return path;
  });
  const png = join(inputs, 'образец.png'),
    pdf = join(inputs, 'document.pdf'),
    zip = join(inputs, 'archive.zip');
  writeFileSync(
    png,
    nativeImage
      .createFromBitmap(Buffer.from([0, 0, 255, 255]), {
        width: 1,
        height: 1,
      })
      .toPNG(),
  );
  writeFileSync(pdf, '%PDF-1.7\nfixture');
  writeFileSync(zip, Buffer.from([80, 75, 3, 4, 0, 0]));
  dialog.showOpenDialog = async (_window, options) => {
    choices.push(options);
    if (delayedPicker)
      return new Promise((resolve) => {
        finishPicker = resolve;
        pickerReady();
      });
    return { canceled: selection === null, filePaths: selection || [] };
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:connection-status'
          ? () => ({ connectionId: account.id, provider: account.providerId, status: 'ready' })
          : name === 'studio:release-reference-files'
            ? (event, ids) => {
                releases.push(ids);
                return action(event, ids);
              }
            : name === 'studio:launch-agent'
              ? (_event, request) => {
                  launches.push(request);
                  throw Error('QA launch intercepted; no Pi/model request');
                }
              : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('Unsaved QA reload');
    app.exit(1);
  });
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error('Timed out: ' + code + '\n' + (await js('document.body.innerText.slice(-1500)')));
  };
  const click = (label, role = 'dialog') =>
    js(
      `Array.from(document.querySelectorAll('[role="${role}"] button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const open = async () => {
    await js(
      `document.querySelector('.project-agent-menu button[aria-label="Запустить"]').click()`,
    );
    await until(`!!document.querySelector('.agent-first-message')`);
  };
  const choose = async (paths) => {
    selection = paths;
    await js(`document.querySelector('[aria-label="Прикрепить файлы референса"]').click()`);
    await until(`!document.querySelector('[aria-label="Прикрепить файлы референса"]').disabled`);
  };
  const count = () => js(`document.querySelectorAll('.reference-attachment-list li').length`);
  await until(`!!document.querySelector('[aria-label="Открыть проект «Attachment check»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Attachment check»"]').click()`);
  await until(`!!document.querySelector('.project-agent-menu')`);
  const before = await readFile(projectFile, 'utf8');
  // Cancellation must release temporary selections; four cancelled 32-file requests
  // must not prevent choosing references again during the same app process.
  for (let round = 0; round < 5; round++) {
    await open();
    await choose(batch);
    assert.equal(await count(), 32, `Cancelled request ${round + 1} exhausted selection capacity`);
    if (round % 2)
      await js(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
      );
    else await click('Отмена');
    await until(`!document.querySelector('.agent-first-message')`);
  }
  assert.equal(launches.length, 0);
  assert.equal(await readFile(projectFile, 'utf8'), before);
  await assert.rejects(access(join(projectDir, '.pistudio/context')));
  // A picker may answer after its parent closes. Release that late result too.
  await open();
  delayedPicker = true;
  const pickerStarted = new Promise((resolve) => {
    pickerReady = resolve;
  });
  await js(`document.querySelector('[aria-label="Прикрепить файлы референса"]').click()`);
  await pickerStarted;
  await click('Отмена');
  await until(`!document.querySelector('.agent-first-message')`);
  const releasedBeforeLatePicker = releases.length;
  delayedPicker = false;
  finishPicker({ canceled: false, filePaths: batch });
  for (let i = 0; i < 200 && releases.length === releasedBeforeLatePicker; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(releases.length, releasedBeforeLatePicker + 1);
  assert.equal(releases.at(-1).length, 32);
  assert.equal(await js(`!!document.querySelector('.agent-first-message')`), false);
  await open();
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Запустить').disabled`,
    ),
    true,
  );
  await choose([png, pdf, zip, batch[0]]);
  assert.equal(await count(), 4);
  await until(`document.querySelector('.reference-thumbnail img')?.naturalWidth>0`);
  assert.equal(
    await js(`document.querySelector('input[type="file"]').getAttribute('accept')`),
    null,
  );
  await choose(null);
  assert.equal(await count(), 4);
  await js(
    `document.querySelector('.reference-attachment [aria-label^="Убрать референс"]').click()`,
  );
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Отмена', 'alertdialog');
  assert.equal(await count(), 4);
  await js(
    `document.querySelector('.reference-attachment [aria-label^="Убрать референс"]').click()`,
  );
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Удалить', 'alertdialog');
  await until(`document.querySelectorAll('.reference-attachment-list li').length===3`);
  assert.ok((await readFile(png)).length);
  await choose([...batch, png]);
  await until(
    `document.querySelector('.reference-attachments [role="alert"]')?.textContent.includes('32')`,
  );
  assert.equal(await count(), 3);
  await choose(batch);
  await until(
    `document.querySelector('.reference-attachments [role="alert"]')?.textContent.includes('одному запросу')`,
  );
  assert.equal(await count(), 3);
  await js(
    `(()=>{const el=document.querySelector('.agent-first-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'QA first message');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click('Запустить');
  await until(
    `!Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Открываем Pi…')`,
  );
  assert.equal(launches.length, 1);
  assert.equal(launches[0].firstMessage, 'QA first message');
  assert.equal(launches[0].autoContinue, false);
  assert.equal(launches[0].projectId, 'qa-project');
  assert.equal(launches[0].agentId, profile.id);
  assert.equal(launches[0].attachments.length, 3);
  assert.ok(launches[0].attachments.every((id) => /^[a-z0-9-]+$/.test(id)));
  assert.equal(new Set(launches[0].attachments).size, 3);
  await click('Отмена');
  await until(`!document.querySelector('.agent-first-message')`);
  assert.equal(await readFile(projectFile, 'utf8'), before);
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().toLowerCase()==='библиотека').click()`,
  );
  for (const kind of ['персонажа', 'локацию']) {
    if (kind === 'локацию')
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Локации')).click()`,
      );
    await js(`document.querySelector('[aria-label="Создать ${kind}"]').click()`);
    await until(`!!document.querySelector('[aria-label="Референсы"]')`);
    await choose(batch);
    assert.equal(await count(), 32);
    await click('Отмена');
    await until(`!document.querySelector('[role="dialog"]')`);
  }
  await assert.rejects(access(join(studio, '.pistudio/library-runs')));
  for (const options of choices) {
    assert.deepEqual(options.properties, ['openFile', 'multiSelections']);
    assert.equal(options.filters, undefined);
  }
  assert.equal(await readFile(batch[0], 'utf8'), 'reference 0');
  console.log(
    'First-message native UI passed: repeated 32-file cancel/Escape, late picker release, mixed chooser without filters, PNG thumbnail, picker cancel, confirmed removal preserving source, per-picker/combined limit errors, required message and correct launch IDs, character/location chooser cancellation. Launch IPC intercepted; no Pi/model or session/context/job writes.',
  );
  clearTimeout(deadline);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  await rm(temporary, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.exit(1);
});
