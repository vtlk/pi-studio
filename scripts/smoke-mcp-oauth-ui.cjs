const { app, shell, safeStorage } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { writeFile, readFile, readdir, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let temporary, fixture;
const deadline = setTimeout(() => {
  console.error('OAuth UI smoke timeout');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-oauth-ui-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData'),
    native = join(temporary, 'NativePi');
  for (const path of [join(studio, '.pistudio'), userData, native])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  process.env.PI_CODING_AGENT_DIR = native;
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  let mode = 'wait',
    browserCount = 0;
  shell.openExternal = async (url) => {
    browserCount++;
    if (mode === 'authorize') await fixture.authorize(url);
  };
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded;
  window.webContents.setBackgroundThrottling(false);
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error('Timeout: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const { oauthMcpFixture } = await import('./fixtures/oauth-mcp.mjs');
  fixture = await oauthMcpFixture();
  await writeFile(
    join(native, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        qa_oauth: {
          url: fixture.url,
          oauth: {
            clientId: 'qa-private-client',
            clientSecret: '${CLIENT_SECRET}',
            scope: 'qa:read',
          },
        },
      },
    }),
  );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `(async()=>{const before=await window.studio.loadStudio();const result=await window.studio.saveSection('resources',[{id:'oauth',name:'QA OAuth MCP',kind:'mcps',source:'pi:qa_oauth',transport:'HTTP',version:'',description:'Synthetic OAuth',args:'',credential:'',contents:'',createdAt:1}],{folder:before.folder,base:before.sections.resources});if(!result.saved)throw new Error('QA save conflicted');})()`,
  );
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('MCP-серверы');
  await until(`document.body.textContent.includes('QA OAuth MCP')`);
  await click('Защищённые параметры');
  await until(`!!document.querySelector('[aria-label="Значение CLIENT_SECRET"]')`);
  await js(
    `(()=>{const e=document.querySelector('[aria-label="Значение CLIENT_SECRET"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(fixture.secret)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click('Сохранить параметры');
  await until(
    `document.querySelector('.dialog-body')?.textContent.includes('Параметры сохранены')`,
  );
  await click('Закрыть');
  await click('Войти через Pi');
  await until(`!!document.querySelector('[aria-label="Адрес возврата OAuth"]')`);
  assert.equal(browserCount, 1);
  assert.equal(fixture.state.authorized, 0);
  assert.equal(
    await js(`document.querySelector('[aria-label="Адрес возврата OAuth"]').type`),
    'password',
  );
  await click('Отмена');
  await until(`!document.querySelector('[role="dialog"]')`);
  const nativeBefore = await readFile(join(native, 'mcp-auth.json'), 'utf8').catch(() => '');
  assert.ok(!nativeBefore.includes('QA_ACCESS_'));
  mode = 'authorize';
  await click('Войти через Pi');
  await until(
    `document.querySelector('[role="dialog"] [role="status"]')?.textContent.includes('MCP доступен')`,
  );
  assert.equal(browserCount, 2);
  assert.equal(fixture.state.clientSecretReceived, true);
  const data = await js('window.studio.loadStudio()');
  assert.equal(data.sections.resources[0].check.status, 'available');
  await until(
    `Array.from(document.querySelectorAll('.resource-row')).some(row=>row.textContent.includes('QA OAuth MCP')&&row.textContent.includes('Доступен'))`,
  );
  assert.equal(
    await js(`document.body.textContent.includes(${JSON.stringify(fixture.secret)})`),
    false,
  );
  assert.ok(!JSON.stringify(data).includes(fixture.secret));
  for (const name of await readdir(join(userData, 'mcp-secrets'))) {
    const cipher = JSON.parse(await readFile(join(userData, 'mcp-secrets', name), 'utf8'));
    const plain = (await safeStorage.decryptStringAsync(Buffer.from(cipher.encrypted, 'base64')))
      .result;
    assert.equal(JSON.parse(plain).values.CLIENT_SECRET, fixture.secret);
  }
  assert.ok(!(await readFile(join(native, 'mcp.json'), 'utf8')).includes(fixture.secret));
  assert.ok(!(await readFile(join(native, 'mcp-auth.json'), 'utf8')).includes(fixture.secret));
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await writeFile(resolve('artifacts/mcp-oauth.png'), (await window.capturePage()).toPNG());
  await click('Закрыть');
  console.log(
    'Native MCP OAuth Electron passed: native safeStorage clientSecret with Chromium mock Keychain, native PKCE/browser callback, masked redirect field, cancel without token, actual availability verification and no credentials in renderer/studio/native config. No external account or model request.',
  );
  clearTimeout(deadline);
  await fixture.close();
  await rm(temporary, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  await fixture?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.exit(1);
});
