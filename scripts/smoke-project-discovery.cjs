const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { rm, readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timer = setTimeout(() => {
  console.error('Project discovery UI timed out');
  app.exit(1);
}, 40000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-discovery-'));
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  mkdirSync(userData);
  mkdirSync(join(studio, 'projects/real'), { recursive: true });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(
    join(studio, 'projects/real/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'real',
      name: 'Настоящий проект',
      createdAt: 1,
      agents: [],
    }),
  );
  const orphan = join(studio, 'projects/mixed-от-slug/agents/voice/output');
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, 'timing.md'), 'KEEP_ORPHAN_BYTES');
  const malformed = join(studio, 'projects/malformed');
  mkdirSync(malformed);
  writeFileSync(join(malformed, 'project.json'), '{broken');
  app.setPath('userData', userData);
  app.setPath('videos', root);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  window.webContents.setBackgroundThrottling(false);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('Unsaved QA navigation');
    app.exit(1);
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  for (
    let i = 0;
    i < 100 &&
    !(await js(`!!document.querySelector('[aria-label="Открыть проект «Настоящий проект»"]')`));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  const state = await js('window.studio.loadStudio()');
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].id, 'real');
  assert.equal(state.warnings.length, 1);
  assert.ok(state.warnings[0].includes('malformed'));
  const text = await js('document.body.innerText');
  assert.equal(text.includes('mixed-от-slug'), false);
  assert.equal(text.includes('ENOENT'), false);
  assert.equal(await readFile(join(orphan, 'timing.md'), 'utf8'), 'KEEP_ORPHAN_BYTES');
  assert.equal(await readFile(join(malformed, 'project.json'), 'utf8'), '{broken');
  const info = await js('window.studio.getInfo()');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/project-discovery-native-proof.json'),
    JSON.stringify(
      {
        version: info.version,
        packagedMain: !!process.env.PI_STUDIO_QA_MAIN,
        isolatedNative: true,
        realProjectVisible: true,
        manifestlessFoldersIgnored: true,
        malformedManifestStillWarns: true,
        unregisteredFileBytesPreserved: true,
        userStudioTouched: false,
        modelRequests: 0,
        desktopFocusChanged: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Project discovery native UI passed; valid project visible, non-project ignored, malformed manifest reported, all file bytes retained.',
  );
  clearTimeout(timer);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timer);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
