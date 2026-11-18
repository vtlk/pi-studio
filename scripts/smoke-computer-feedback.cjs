const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const ts = require('typescript');

const temporary = mkdtempSync(join(tmpdir(), 'pistudio-computer-feedback-'));
app.setPath('userData', temporary);
const qa = require('./offscreen-main.cjs');
qa.configureQaRuntime();
app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let overlay;
const owned = new Set();
app.on('browser-window-created', (_event, window) => {
  owned.add(window);
  window.once('closed', () => owned.delete(window));
});
const liveWindows = () => [...owned].filter((window) => !window.isDestroyed());

(async () => {
  await app.whenReady();
  // Load the actual TypeScript class through the same hidden-window guard as native UI QA.
  const entry = resolve('src/main/computer/ComputerOverlay.ts');
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => {
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    module._compile(source, filename);
  };
  // The production class resolves the build relative to out/main; here only remap loadFile's path.
  const originalLoadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (file, ...args) {
    return originalLoadFile.call(
      this,
      file.endsWith('computer-overlay.html') ? resolve('out/renderer/computer-overlay.html') : file,
      ...args,
    );
  };
  qa.loadOffscreenMain(entry);
  const { ComputerOverlay } = require(entry);
  await require(resolve('src/shared/i18n/index.ts')).i18n.changeLanguage('ru');
  if (previous) require.extensions['.ts'] = previous;
  else delete require.extensions['.ts'];

  const focused = BrowserWindow.getFocusedWindow();
  overlay = new ComputerOverlay();
  assert.equal(liveWindows().length, 0);
  await overlay.begin('private-session-a', 'Сцены', 'Нажимает');
  const displays = screen.getAllDisplays();
  const windows = liveWindows();
  assert.equal(windows.length, displays.length);
  const primary = screen.getPrimaryDisplay();
  const window = windows.find(
    (item) => item.getBounds().x === primary.bounds.x && item.getBounds().y === primary.bounds.y,
  );
  assert.ok(window);
  const js = (code) => window.webContents.executeJavaScript(code);
  for (let i = 0; i < 50; i++) {
    if (await js('!!document.querySelector(".computer-indicator")')) break;
    await wait(20);
  }
  assert.equal(
    await js(
      'document.querySelector(".computer-indicator").textContent.includes("Сцены использует компьютер")',
    ),
    true,
  );
  assert.equal(await js('typeof window.studio'), 'undefined');
  assert.equal(await js('typeof require'), 'undefined');
  assert.equal(await js('getComputedStyle(document.body).pointerEvents'), 'none');
  assert.equal(await js('getComputedStyle(document.body).backgroundColor'), 'rgba(0, 0, 0, 0)');
  for (const item of windows) {
    assert.equal(item.isFocusable(), false);
    assert.equal(item.isVisible(), false);
    assert.equal(item.webContents.isOffscreen(), true);
    assert.equal(item.webContents.getLastWebPreferences().sandbox, true);
    assert.equal(item.webContents.getLastWebPreferences().preload, undefined);
  }
  await overlay.pointer(
    'private-session-a',
    {
      x: primary.bounds.x + primary.bounds.width * 0.58,
      y: primary.bounds.y + primary.bounds.height * 0.45,
    },
    true,
  );
  await wait(50);
  assert.equal(await js('document.querySelectorAll(".computer-click-ring").length'), 1);
  assert.equal(await js('document.querySelector(".computer-pointer-label").textContent'), 'Сцены');
  mkdirSync('artifacts', { recursive: true });
  const image = await window.capturePage();
  writeFileSync('artifacts/computer-feedback-preview.png', image.toPNG());
  // Presentation strings are text, including hostile markup; no HTML interpretation.
  await overlay.begin('private-session-b', '<img src=x onerror=alert(1)>\u202e', 'Читает окно');
  await wait(30);
  assert.equal(await js('document.querySelectorAll("img").length'), 0);
  assert.equal(await js('document.querySelectorAll(".computer-pointer").length'), 0);
  overlay.release('private-session-a');
  assert.equal(
    liveWindows().length,
    displays.length,
    'A stale session cannot remove another agent indicator.',
  );
  await overlay.suspend();
  await overlay.resume();
  overlay.finish('private-session-b');
  await wait(5150);
  assert.equal(liveWindows().length, 0, 'Idle feedback is removed.');
  const loading = overlay.begin('cancel-during-load', 'Отмена', 'Читает окно');
  overlay.release('cancel-during-load');
  await loading.catch(() => {});
  await wait(30);
  assert.equal(liveWindows().length, 0, 'A late load cannot resurrect released feedback.');
  assert.equal(BrowserWindow.getFocusedWindow(), focused);
  overlay.close();
  const proof = {
    checkedAt: new Date().toISOString(),
    actualOverlayClass: true,
    builtNativeRenderer: true,
    hiddenOffscreenWindowsOnly: true,
    isolatedUserData: true,
    noPreloadOrNodeInRenderer: true,
    sandbox: true,
    nonFocusable: true,
    screenFrame: true,
    agentName: true,
    clickPulse: true,
    markupEscaped: true,
    idleCleanup: true,
    scopedRelease: true,
    cancelledLoadDoesNotResurrect: true,
    displays: displays.length,
    limits:
      'Hidden renderer/host tests only. No real desktop capture/input, focus handoff, macOS Spaces/fullscreen, or native multi-monitor acceptance; no installed app replacement.',
  };
  writeFileSync('artifacts/computer-feedback-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(
    'Computer feedback passed: native hidden overlay, cursor/name/click, frame, isolation and lifecycle.',
  );
  BrowserWindow.prototype.loadFile = originalLoadFile;
  rmSync(temporary, { recursive: true, force: true });
  app.quit();
})().catch((error) => {
  console.error(error);
  overlay?.close();
  for (const window of liveWindows()) window.destroy();
  rmSync(temporary, { recursive: true, force: true });
  app.exit(1);
});
