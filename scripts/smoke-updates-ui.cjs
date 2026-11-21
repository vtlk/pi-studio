// Actual shared UI/provider/preload, controlled status fixture only. No installer/model/user data.
const { app, BrowserWindow, ipcMain } = require('electron');
const { realpathSync, mkdirSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve, relative, basename } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
if (!process.env.PI_STUDIO_UPDATE_UI_ROOT)
  throw Error('Run node scripts/run-update-ui.cjs so cleanup follows actual process exit.');
const root = realpathSync(process.env.PI_STUDIO_UPDATE_UI_ROOT);
const location = relative(realpathSync(tmpdir()), root);
if (!location || location.startsWith('..') || !basename(root).startsWith('pistudio-update-ui-'))
  throw Error('Unowned update UI profile');
mkdirSync(join(root, 'UserData'));
app.setPath('userData', join(root, 'UserData'));
require('./offscreen-main.cjs').configureQaRuntime();
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => {
  console.error('Update UI timed out');
  app.exit(1);
}, 60000);
let window;
let failed = false;
let state = { currentVersion: '0.2.0-alpha.75', phase: 'idle' };
const reports = [];
let requests = 0;
let checks = 0;
const offer = {
  version: '0.2.0-alpha.76',
  bytes: 100000000,
  notes: 'Новая проверенная версия\nБез автозапуска агентов.',
  releaseUrl: '',
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(code) {
  const limit = Date.now() + 6000;
  while (Date.now() < limit) {
    if (await window.webContents.executeJavaScript(`Boolean(${code})`)) return;
    await wait(30);
  }
  throw Error('UI condition timed out: ' + code);
}
const read = (code) => window.webContents.executeJavaScript(code);
(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const output = join(root, 'renderer');
  await build({
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [react()],
    resolve: { alias: { '@': resolve('src/renderer') } },
    build: {
      outDir: output,
      emptyOutDir: true,
      rollupOptions: { input: resolve('scripts/fixtures/updates-ui.html') },
    },
    logLevel: 'error',
  });
  ipcMain.handle('studio:update-state', () => structuredClone(state));
  ipcMain.handle('studio:update-readiness', (_event, value) => {
    reports.push(value);
    if (value.manualCheckToken && value.manualCheckToken === state.manualCheckToken)
      state = { ...state, manualCheckToken: undefined };
  });
  ipcMain.handle('studio:update-check', async () => {
    checks++;
    state = { ...state, phase: 'checking', message: undefined };
    await wait(150);
    state = { ...state, phase: 'available', offer };
    return state;
  });
  ipcMain.handle('studio:update-request', () => {
    requests++;
    state = { ...state, phase: 'downloading', downloaded: 25000000 };
  });
  await app.whenReady();
  window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 780,
    webPreferences: {
      preload: resolve('out/preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('Fixture renderer:', event.message);
  });
  await window.loadFile(join(output, 'scripts/fixtures/updates-ui.html'));
  window.webContents.debugger.attach('1.3');
  // Chromium focus emulation inside this owned offscreen target; never OS/window activation.
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  await until(`document.querySelector('[aria-label="Рабочее поле"]')`);
  assert.equal(
    await read(`!!document.querySelector('button[aria-label*="Доступна версия"]')`),
    false,
  );
  state = { ...state, phase: 'checking', manualCheckToken: 'manual-first' };
  await until(
    `document.querySelector('[data-update-dialog]')?.textContent.includes('Проверяем обновления')`,
  );
  state = { ...state, phase: 'idle', checkedAt: Date.now() };
  await until(
    `document.querySelector('[data-update-dialog]')?.textContent.includes('Установлена актуальная версия')`,
  );
  await read(
    `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent==='Понятно').click()`,
  );
  await until(`!document.querySelector('[data-update-dialog]')`);
  state = { ...state, phase: 'checking' };
  await wait(650);
  assert.equal(
    await read(`!!document.querySelector('[data-update-dialog]')`),
    false,
    'Background checks do not reopen result dialogs',
  );
  for (const staleOffer of [undefined, offer]) {
    state = {
      ...state,
      phase: 'error',
      message: 'QA offline',
      offer: staleOffer,
      manualCheckToken: staleOffer ? 'manual-stale' : 'manual-empty',
    };
    await until(
      `document.querySelector('[data-update-dialog] [role="alert"]')?.textContent==='QA offline'`,
    );
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent===${JSON.stringify(staleOffer ? 'Повторить проверку' : 'Повторить')}).click()`,
    );
    await until(`document.querySelector('[data-update-dialog]')?.textContent.includes('Обновить')`);
    assert.equal(requests, 0, 'Retrying a manual check never authorizes downloading');
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent==='Позже').click()`,
    );
    await until(`!document.querySelector('[data-update-dialog]')`);
  }
  assert.equal(checks, 2);
  state = { ...state, phase: 'available', offer };
  await until(`document.querySelector('button[aria-label*="Доступна версия"]')`);
  await read(`document.querySelector('button[aria-label*="Доступна версия"]').focus()`);
  assert.equal(
    await read(`document.activeElement?.getAttribute('aria-label')`),
    `Доступна версия ${offer.version} — обновить`,
  );
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 36,
    text: '\r',
    unmodifiedText: '\r',
  });
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 36,
  });
  await until(`document.querySelector('[role="dialog"][aria-label="Обновление Pi Studio"]')`);
  assert.equal(requests, 0);
  for (const language of ['ru', 'en']) {
    const catalog = require('../src/shared/i18n/' + language + '.json');
    await read(`window.__updateQaLanguage(${JSON.stringify(language)})`);
    state = { ...state, phase: 'verifying', message: undefined };
    await until(
      `document.querySelector('[data-update-dialog] [role="status"]')?.textContent===${JSON.stringify(catalog['UpdateAction.verifyingPackage'])}`,
    );
    for (const key of [
      'error.privateDirectory.couldNotDetermineTheUpdate',
      'error.privateDirectory.couldNotProtectTheUpdate',
    ]) {
      state = { ...state, phase: 'error', message: catalog[key] };
      await until(
        `document.querySelector('[data-update-dialog] [role="alert"]')?.textContent===${JSON.stringify(catalog[key])}`,
      );
      assert.equal(
        await read(
          `document.querySelector('[data-update-dialog]').textContent.includes('EncodedCommand')`,
        ),
        false,
      );
      assert.equal(
        await read(
          `[...document.querySelectorAll('[data-update-dialog] button')].some(button=>button.textContent===${JSON.stringify(catalog['StartupGate.retry'])})`,
        ),
        true,
      );
    }
  }
  await read(`window.__updateQaLanguage('ru')`);
  const cachedOfferNotice =
    'GitHub временно ограничил проверку обновлений. Ранее найденную и проверенную версию можно установить.';
  state = {
    ...state,
    phase: 'available',
    message: cachedOfferNotice,
    manualCheckToken: 'cached-offer',
  };
  await until(
    `[...document.querySelectorAll('[data-update-dialog] button')].some(button=>button.textContent==='Обновить') && !document.querySelector('[data-update-dialog] [role="alert"]')`,
  );
  assert.equal(
    await read(`document.querySelector('[data-update-dialog] [role="status"]').textContent`),
    cachedOfferNotice,
  );

  await read(
    `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent==='Позже').click()`,
  );
  await until(`!document.querySelector('[data-update-dialog]')`);
  assert.equal(requests, 0);
  state = { ...state, manualCheckToken: 'cached-offer-consent' };
  await until(`document.querySelector('[data-update-dialog]')`);
  await read(
    `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent==='Обновить').click()`,
  );
  await until(`document.querySelector('progress')?.value===25000000`);
  assert.equal(requests, 1);
  assert.equal(checks, 2, 'Cached offer consent does not dispatch another manual check');
  assert.equal(
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].some(b=>b.textContent==='Обновить')`,
    ),
    false,
  );
  state = {
    ...state,
    phase: 'waiting',
    message: 'Установим после сохранения и завершения работы.',
  };
  await until(`document.body.textContent.includes('Установим после сохранения')`);
  await read(
    `[...document.querySelectorAll('[data-update-dialog] button')].find(b=>b.textContent==='Скрыть').click()`,
  );
  await until(`!document.querySelector('[data-update-dialog]')`);
  await read(
    `[...document.querySelectorAll('main button')].find(b=>b.textContent==='Открыть черновик').click()`,
  );
  await until(`document.querySelector('[aria-label="Черновик QA"]')`);
  await wait(650);
  assert.equal(reports.at(-1).saved, false);
  await read(
    `document.querySelector('[aria-label="Черновик QA"] button[aria-label="Закрыть окно"]').click()`,
  );
  await until(`!document.querySelector('[aria-label="Черновик QA"]')`);
  state = { ...state, prepareToken: 'current-saved-lease' };
  const reportLimit = Date.now() + 5000;
  while (
    !reports.some((value) => value.token === 'current-saved-lease') &&
    Date.now() < reportLimit
  )
    await wait(30);
  const acknowledgement = reports.find((value) => value.token === 'current-saved-lease');
  assert.equal(acknowledgement?.saved, true);
  assert.deepEqual(acknowledgement.view, { page: 'projects', projectId: 'qa-project' });
  assert.equal(await read(`document.querySelector('main').inert`), true);
  assert.equal(
    await read(
      `document.querySelector('[data-update-dialog] button[aria-label="Закрыть окно"]')?.disabled`,
    ),
    true,
  );
  await read(
    `document.querySelector('[data-update-dialog] section').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  assert.equal(await read(`!!document.querySelector('[data-update-dialog]')`), true);
  state = {
    ...state,
    prepareToken: undefined,
    phase: 'error',
    message: 'Пакет повреждён. Прежняя версия сохранена.',
  };
  await until(`document.querySelector('[role="alert"]')?.textContent.includes('Пакет повреждён')`);
  assert.equal(await read(`document.querySelector('main').inert`), false);
  assert.equal(
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].some(b=>b.textContent==='Повторить')`,
    ),
    true,
  );
  state = {
    ...state,
    maintenanceError: 'Временная программа сохранена: неизвестные файлы.',
    phase: 'available',
  };
  await until(
    `document.querySelector('[role="alert"]')?.textContent.includes('неизвестные файлы')`,
  );
  assert.equal(
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].some(b=>b.textContent==='Повторить очистку')`,
    ),
    true,
  );
  assert.equal(
    await read(
      `[...document.querySelectorAll('[data-update-dialog] button')].some(b=>b.textContent==='Обновить')`,
    ),
    false,
    'Cleanup error has priority over another available offer',
  );
  state = { ...state, offer: undefined };
  await until(
    `!!document.querySelector('button[aria-label="Временные файлы обновления сохранены — сведения"]')`,
  );
  assert.equal(requests, 1, 'Maintenance information does not start another download');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/update-ui.png', (await window.webContents.capturePage()).toPNG());
  const proof = {
    checkedAt: new Date().toISOString(),
    scope:
      'Actual feature provider/shared UI and production preload in an isolated offscreen Electron window; controlled update state only, not a native installer or app lifecycle integration.',
    noOfferNoIcon: true,
    keyboardOpen: true,
    laterDoesNotDownload: true,
    explicitRequestOnce: true,
    progressAndError: true,
    windowsStagingErrorsReplaceVerifyingInlineInRussianAndEnglish: true,
    windowsStagingErrorOffersRetryWithoutEncodedCommand: true,
    transientDialogBlocksReady: true,
    tokenFlushAcknowledged: true,
    applicationInertDuringLease: true,
    freezingDialogCannotDismiss: true,
    maintenanceErrorVisibleWithoutOffer: true,
    maintenanceErrorTakesPriorityOverNewOffer: true,
    manualCheckingUpToDateAndError: true,
    manualErrorRetryDoesNotAuthorizeDownloadEvenWithStaleOffer: true,
    previouslyVerifiedOfferCanBeDownloadedFromManualDialogDuringRateLimit: true,
    consumedManualNoticeDoesNotReopenOnBackgroundChecks: true,
    clipboardOrAudioOrModelAccess: false,
    userStudioAccess: false,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/update-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
})()
  .catch((error) => {
    console.error(error);
    failed = true;
    if (window && !window.isDestroyed())
      return read(
        `JSON.stringify({focus:document.hasFocus(),active:document.activeElement?.outerHTML,body:document.body.innerText.slice(0,2000)})`,
      ).then((value) => console.error('Isolated UI diagnostic:', value));
  })
  .finally(async () => {
    clearTimeout(deadline);
    window?.destroy();
    app.exit(failed ? 1 : 0);
  });
