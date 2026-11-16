const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { readFile, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
let root,
  win,
  initialized = 0,
  decrypted = 0,
  network = 0;
const deadline = setTimeout(() => fail(Error('Passive image status QA timed out')), 30000);
async function cleanup() {
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  app.setActivationPolicy('accessory');
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-image-status-')));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  for (const path of [studio, userData, join(studio, '.pistudio'), join(userData, 'secrets')])
    mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        imageTool: { connectionId: 'qa-images', modelId: 'gpt-image-2' },
        connections: [
          {
            id: 'qa-images',
            name: 'QA Images',
            purpose: 'images',
            providerId: 'openai',
            endpoint: '',
            account: '',
            createdAt: 1,
          },
        ],
      },
    }),
  );
  const vaultFile = join(
    userData,
    'secrets',
    createHash('sha256').update(studio).update('\0').update('qa-images').digest('hex') + '.json',
  );
  const ciphertext = JSON.stringify({
    version: 1,
    encrypted: Buffer.from('Opaque QA ciphertext; never decrypt').toString('base64'),
  });
  writeFileSync(vaultFile, ciphertext);
  // Own QA process only: tripwires prevent any access to the real system Keychain.
  safeStorage.isAsyncEncryptionAvailable = async () => {
    initialized++;
    return false;
  };
  safeStorage.decryptStringAsync = async () => {
    decrypted++;
    throw Error('Unexpected decryption');
  };
  safeStorage.encryptStringAsync = async () => {
    throw Error('Unexpected encryption');
  };
  global.fetch = async () => {
    network++;
    throw Error('No network expected');
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : action,
    );
  const loaded = new Promise((r) =>
    app.once('browser-window-created', (_, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => r(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  win = await loaded;
  win.webContents.removeAllListeners('will-prevent-unload');
  win.webContents.on('will-prevent-unload', () => void fail(Error('Unsaved QA reload')));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await until(
    `document.body.textContent.includes('Генерация изображений — настроен · авторизация не проверена')`,
  );
  assert.equal(
    await js(`document.body.textContent.includes('Генерация изображений — не подключён')`),
    false,
  );
  await click('Подключения');
  await until(`document.body.textContent.includes('Ключ сохранён · авторизация не проверена')`);
  await click('Настроить');
  await until(`document.body.textContent.includes('Ключ сохранён. Авторизация ещё не проверена.')`);
  assert.equal(await js(`document.querySelector('[aria-label="API-ключ изображений"]').value`), '');
  assert.equal(initialized, 0);
  assert.equal(decrypted, 0);
  await click('Отмена');
  await until(
    `!document.querySelector('[role="dialog"]') && !!document.querySelector('[data-save-state="idle"]')`,
  );
  const reloaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload();
  await reloaded;
  await until(`!!document.querySelector('[aria-label="Настройки"]')`);
  const state = await js('window.studio.loadStudio()');
  const status = await js(
    `window.studio.readImageConnection(${JSON.stringify({ folder: studio, connectionId: 'qa-images' })})`,
  );
  assert.deepEqual(status, { keyStored: true, authentication: 'unchecked', modelIds: [] });
  assert.equal(initialized, 0);
  assert.equal(decrypted, 0);
  assert.equal(network, 0);
  assert.equal(JSON.stringify(state).includes('Opaque QA'), false);
  // Explicit API check still requires protected storage and must not reach the network.
  const error = await js(
    `window.studio.checkImageConnection(${JSON.stringify({ folder: studio, connectionId: 'qa-images' })}).then(()=>'',error=>error.message)`,
  );
  assert.ok(error.includes('Защищённое хранилище macOS недоступно'));
  assert.equal(initialized, 1);
  assert.equal(decrypted, 0);
  assert.equal(network, 0);
  assert.equal(await readFile(vaultFile, 'utf8'), ciphertext);
  const paths = [
    'src/main/images/ImageConnections.ts',
    'src/shared/connections.ts',
    'src/renderer/features/connections/ui/ImageKeyFields.tsx',
    'src/renderer/features/connections/model/useCoreTools.ts',
    'src/renderer/features/settings/ui/SettingsView.tsx',
    'src/renderer/features/launch/ui/dialogs/PromptDialog.tsx',
    'tests/images.test.ts',
    'scripts/smoke-image-status.cjs',
  ];
  const proof = {
    sourceVersion: require('../package.json').version,
    packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
    passed: {
      nativeCatalogAndEditorWithoutCryptoInitialization: true,
      noSecretReturnedToRenderer: true,
      reloadStatusWithoutCryptoInitialization: true,
      explicitCheckStillRejectsUnavailableStorage: true,
      ciphertextUnchanged: true,
      workspaceSummaryUsesActualImageSettings: true,
    },
    passiveCryptoInitializations: 0,
    explicitCryptoInitializations: initialized,
    decryptionCalls: decrypted,
    networkCalls: network,
    limits:
      'Actual production main/preload/renderer, offscreen isolated studio. safeStorage uses tripwires and startup/catalog fixtures; real Keychain access, user Always Allow persistence and OS password prompts are not tested.',
    sourceSha256: Object.fromEntries(
      await Promise.all(
        paths.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(__dirname, '..', path)))
            .digest('hex'),
        ]),
      ),
    ),
  };
  await writeFile(
    join(__dirname, '../artifacts/passive-image-status-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
  await cleanup();
  app.exit(0);
})().catch(fail);
