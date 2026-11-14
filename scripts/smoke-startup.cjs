const { app, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

// Deterministic presentation fixture; no installation or user data access.
let temporary;
const deadline = setTimeout(() => app.exit(1), 20000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-startup-ui-'));
  for (const key of ['documents', 'videos', 'userData']) {
    const path = join(temporary, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  // Override only the presentation transport before the renderer starts.
  const originalHandle = ipcMain.handle.bind(ipcMain);
  let phase = 'downloading';
  ipcMain.handle = (channel, action) => {
    if (channel === 'studio:startup')
      return originalHandle(channel, () =>
        phase === 'skipped'
          ? { phase, message: 'Студия открыта без Pi.' }
          : { phase, message: 'Загружаем компоненты Pi…', progress: 0.65 },
      );
    if (channel === 'studio:startup-skip')
      return originalHandle(channel, () => ({
        phase: (phase = 'skipped'),
        message: 'Студия открыта без Pi.',
      }));
    return originalHandle(channel, action);
  };
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  const js = (code) => window.webContents.executeJavaScript(code, true);
  async function until(code) {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Startup UI timed out: ${code}`);
  }
  await until(
    `document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '65'`,
  );
  assert.equal(
    await js(
      `document.querySelector('.startup-icon').complete && document.querySelector('.startup-icon').naturalWidth > 0`,
    ),
    true,
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/startup-screen.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Открыть без Pi').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  console.log(
    'Startup UI passed: fixture download progress presentation, branding, skip and empty studio. Real installation is covered separately by test:fresh-startup.',
  );
  clearTimeout(deadline);
  await rm(temporary, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.exit(1);
});
