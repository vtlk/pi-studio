const { app, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = mkdtempSync(join(tmpdir(), 'pistudio-web-bundle-'));
app.setPath('userData', root);
const deadline = setTimeout(() => {
  console.error('Web bundle smoke timed out');
  app.exit(1);
}, 30000);
(async () => {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw Error('Timed out: ' + code);
  };
  await window.loadURL('http://127.0.0.1:5173/');
  await until(`!!document.querySelector('[aria-label="Открыть проект «Посылка с характером»"]')`);
  assert.equal(await js('typeof window.studio'), 'undefined');
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(b=>b.textContent.trim()==='Библиотека').click()`,
  );
  await until(`document.querySelectorAll('.asset-thumb-wrap').length===13`);
  await until(`!!document.querySelector('.animated-character svg')`);
  assert.equal(await js(`!!document.querySelector('.character-preview-error')`), false);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Локации') && b.textContent.includes('3'))`,
    ),
    true,
  );
  await js(
    `Array.from(document.querySelectorAll('.topbar nav button')).find(b=>b.textContent.trim()==='Агенты').click()`,
  );
  await until(`!!document.querySelector('[aria-label="Добавить агента"]')`);
  assert.equal(
    await js(`document.querySelectorAll('.agent-list-entry:not([data-system-role])').length`),
    6,
  );
  clearTimeout(deadline);
  console.log(
    'Web bundle passed: demo project, 13 characters/3 locations, original SVG rig scripts, six example profiles, no native bridge.',
  );
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  await rm(root, { recursive: true, force: true });
  app.exit(1);
});
