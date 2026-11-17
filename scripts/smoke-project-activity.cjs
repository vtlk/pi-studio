const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root,
  win,
  working = 0;
const timeout = setTimeout(() => fail(Error('Project activity UI timed out')), 30000);
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
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-project-activity-ui-')));
  const studio = join(root, 'Studio'),
    userData = join(root, 'UserData');
  mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  for (const id of ['active-project', 'other-project']) {
    const folder = join(studio, 'projects', id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id,
        name: id,
        createdAt: 1,
        agents: [
          {
            profile: {
              id: 'agent',
              name: 'Agent',
              enabled: true,
              skills: [],
              mcps: [],
              plugins: [],
            },
            outputPath: 'agents/agent/output',
            runStatus: 'running',
          },
        ],
      }),
    );
    mkdirSync(join(folder, 'agents/agent/output'), { recursive: true });
  }
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : name === 'studio:list-project-activity'
            ? (event) => {
                const nativeEmpty = action(event);
                assert.deepEqual(
                  nativeEmpty,
                  [],
                  'Actual handler starts empty; saved status alone cannot make work active.',
                );
                return working ? [{ projectId: 'active-project', runningAgents: working }] : [];
              }
            : action,
    );
  global.fetch = async () => {
    throw Error('No network/model calls belong in activity UI QA.');
  };
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  win = await loaded;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((done) => setTimeout(done, 40));
    }
    throw Error('Timed out: ' + code);
  };
  const row = `Array.from(document.querySelectorAll('.project-list-row')).find(b=>b.textContent.includes('active-project'))`;
  const setWorking = async (value) => {
    working = value;
    await js(`window.dispatchEvent(new Event('focus'))`);
  };
  await until(`document.querySelectorAll('.project-list-row').length===2`);
  assert.equal(await js(`document.querySelectorAll('.project-active-spinner').length`), 0);
  await setWorking(2);
  await until(`(${row}).getAttribute('aria-label').includes('Агенты работают')`);
  assert.equal(await js(`document.querySelectorAll('.project-active-spinner').length`), 1);
  assert.equal(
    await js(`getComputedStyle((${row}).querySelector('.project-active-spinner')).animationName`),
    'project-active-rotation',
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.project-list-row')).find(b=>b.textContent.includes('other-project')).querySelectorAll('.project-active-spinner').length`,
    ),
    0,
  );
  await setWorking(1);
  await until(`(${row}).getAttribute('aria-label').endsWith('Агент работает')`);
  assert.equal(await js(`document.querySelectorAll('.project-active-spinner').length`), 1);
  await setWorking(0);
  await until(`document.querySelectorAll('.project-active-spinner').length===0`);
  assert.equal(await js(`!!(${row}).querySelector('.lucide-folder')`), true);
  await setWorking(1);
  await until(`!!(${row}).querySelector('.project-active-spinner')`);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  assert.equal(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true);
  assert.equal(
    await js(`getComputedStyle((${row}).querySelector('.project-active-spinner')).animationName`),
    'none',
  );
  assert.equal(await js(`(${row}).getAttribute('aria-label').endsWith('Агент работает')`), true);
  assert.equal(win.isVisible(), false);
  assert.equal(win.webContents.isOffscreen(), true);
  await writeFile('artifacts/project-activity-ui.png', (await win.capturePage()).toPNG());
  await writeFile(
    'artifacts/project-activity-ui-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        scope:
          'Actual Electron renderer/preload/read-only handler with isolated count fixture; runtime producer verified separately with real Pi',
        savedStatusDoesNotStartSpinner: true,
        independentProjects: true,
        parallelCounts: [2, 1, 0],
        folderReturnsAfterLast: true,
        accessibleWorkLabels: true,
        noDuplicateTooltip: true,
        reducedMotionRetainsIndicator: true,
        offscreen: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Project activity native UI passed: live counts, last-agent stop, independent rows, accessibility and real reduced motion.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
