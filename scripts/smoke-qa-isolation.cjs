const { app, BrowserWindow, safeStorage, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { rm, writeFile, access } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let root;
const timeout = setTimeout(() => fail(Error('QA isolation timed out')), 20000);
async function cleanup() {
  clearTimeout(timeout);
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
  let mutations = 0;
  const sandbox = {
    module: { exports: {} },
    process,
    require: (id) =>
      id === 'electron'
        ? {
            app: {
              getPath: () => process.cwd(),
              isReady: () => false,
              setName: () => mutations++,
              commandLine: { appendSwitch: () => mutations++ },
              setActivationPolicy: () => mutations++,
            },
          }
        : require(id),
  };
  vm.runInNewContext(readFileSync(join(__dirname, 'offscreen-main.cjs'), 'utf8'), sandbox);
  assert.throws(() => sandbox.module.exports.configureQaRuntime(), /own userData/);
  assert.equal(mutations, 0, 'Refuse the non-temporary profile before changing name/backend');
  root = mkdtempSync(join(tmpdir(), 'pistudio-qa-isolation-'));
  const data = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(data);
  mkdirSync(studio);
  app.setPath('userData', data);
  app.setPath('videos', root);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'ready', message: 'QA' }) : action);
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => done(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  assert.equal(app.getName(), 'Pi Studio QA');
  assert.equal(app.getPath('sessionData'), require('node:fs').realpathSync(data));
  assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true);
  app.setName('Pi Studio');
  assert.equal(app.getName(), 'Pi Studio QA');
  assert.equal(window.isVisible(), false);
  assert.equal(window.webContents.isOffscreen(), true);
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
  const synthetic = 'QA_SYNTHETIC_VALUE_ONLY';
  const cipher = await safeStorage.encryptStringAsync(synthetic);
  assert.notEqual(cipher.toString(), synthetic);
  assert.equal((await safeStorage.decryptStringAsync(cipher)).result, synthetic);
  await assert.rejects(
    access(
      '/Users/user1/Applications/Pi Studio.app/Contents/Resources/app/scripts/offscreen-main.cjs',
    ),
  );
  await writeFile(
    'artifacts/qa-isolation-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version: require('../package.json').version,
        nonTemporaryUserDataRejectedBeforeMutation: true,
        separateQaApplicationName: true,
        temporarySessionData: true,
        chromiumMockKeychain: true,
        nativeAsyncCryptoRoundTrip: true,
        offscreenNoVisibleWindow: true,
        qaLoaderAbsentFromInstalledApp: true,
        realKeychainAccessTested: false,
        userKeychainPermissionsChanged: false,
        scope:
          'Synthetic credentials and Chromium official mock provider. Actual signed Pi Studio Always Allow/restarts remain unverified.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'QA isolation passed: non-temporary data rejected, separate name, mock Keychain async crypto, hidden window; production app unchanged.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
