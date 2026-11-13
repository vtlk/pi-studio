const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { readFile, readdir, rm, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const assert = require('node:assert/strict');
let temporary, server;
const deadline = setTimeout(() => {
  console.error('MCP secrets smoke timed out');
  app.exit(1);
}, 90000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-mcp-secrets-ui-'));
  const studio = join(temporary, 'Studio'),
    userData = join(temporary, 'UserData'),
    native = join(temporary, 'NativePi');
  for (const path of [userData, native, join(studio, '.pistudio')])
    mkdirSync(path, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = native;
  const httpKey = 'SYNTHETIC_HTTP_${HOME}_KEY',
    stdioKey = '!SYNTHETIC_STDIO_$HOME_KEY';
  let authorized = 0;
  server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer ' + httpKey) {
      response.writeHead(401);
      response.end();
      return;
    }
    authorized++;
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const data = JSON.parse(text);
    if (!('id' in data)) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      data.method === 'initialize'
        ? {
            protocolVersion: data.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'Protected fixture', version: '1' },
          }
        : {
            tools: [
              {
                name: 'protected_value',
                description: 'Return a test marker',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/mcp';
  const stdio = join(temporary, 'fixture-mcp.mjs');
  writeFileSync(
    stdio,
    `import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';
if(createHash('sha256').update(process.env.SERVICE_TOKEN||'').digest('hex')!==${JSON.stringify(createHash('sha256').update(stdioKey).digest('hex'))})process.exit(2);
for await(const line of createInterface({input:process.stdin})){const data=JSON.parse(line);if(!('id'in data))continue;const result=data.method==='initialize'?{protocolVersion:data.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'Protected stdio',version:'1'}}:{tools:[{name:'protected_value',description:'Return test marker',inputSchema:{type:'object',properties:{}}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:data.id,result})+'\\n');}`,
  );
  writeFileSync(
    join(native, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        protected_http: { url, headers: { Authorization: 'Bearer ${HTTP_KEY}' } },
        protected_stdio: {
          command: '/usr/bin/env',
          args: ['node', stdio],
          env: { SERVICE_TOKEN: '${STDIO_KEY}' },
        },
      },
    }),
  );
  const resources = ['http', 'stdio'].map((kind) => ({
    id: 'protected-' + kind,
    name: 'Protected ' + kind,
    kind: 'mcps',
    source: 'pi:protected_' + kind,
    description: '',
    transport: kind === 'http' ? 'HTTP' : 'stdio',
    args: '',
    credential: '',
    contents: '',
    version: '',
    createdAt: kind === 'http' ? 2 : 1,
  }));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({ schemaVersion: 1, sections: { resources } }),
  );
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  app.setPath('userData', userData);
  app.setPath('videos', temporary);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_event, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('../out/main/index.cjs');
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.setBackgroundThrottling(false);
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out ' + code + ' ' + (await js('document.body.innerText.slice(-1600)')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const rowAction = (kind, action) =>
    js(
      `Array.from(document.querySelectorAll('.resource-row')).find(row=>row.textContent.includes(${JSON.stringify('Protected ' + kind)})).querySelectorAll('button').values().find(button=>button.textContent.trim()===${JSON.stringify(action)}).click()`,
    );
  const value = async (name, text) =>
    js(
      `(()=>{const input=document.querySelector('[aria-label="Значение ${name}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(`!!document.querySelector('[aria-label="Настройки"]')`);
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await click('MCP-серверы');
  await rowAction('http', 'Защищённые параметры');
  await until(`!!document.querySelector('[aria-label="Значение HTTP_KEY"]')`);
  assert.equal(
    await js(`document.querySelector('[aria-label="Значение HTTP_KEY"]').type`),
    'password',
  );
  assert.equal(await js(`document.querySelector('[aria-label="Значение HTTP_KEY"]').value`), '');
  await value('HTTP_KEY', httpKey);
  await click('Сохранить параметры');
  await until(`document.querySelector('.dialog-body')?.innerText.includes('Параметры сохранены')`);
  assert.equal(await js(`document.querySelector('[aria-label="Значение HTTP_KEY"]').value`), '');
  await click('Закрыть');
  await rowAction('http', 'Защищённые параметры');
  await until(
    `document.querySelector('.dialog-body')?.textContent.includes('HTTP_KEY · сохранён')`,
  );
  assert.equal(await js(`document.querySelector('[aria-label="Значение HTTP_KEY"]').value`), '');
  const request = {
    folder: (await js('window.studio.loadStudio()')).folder,
    resourceId: 'protected-http',
  };
  const status = await js(`window.studio.readMcpSecretStatus(${JSON.stringify(request)})`);
  assert.equal(JSON.stringify(status).includes(httpKey), false);
  assert.equal(await js('typeof window.studio.getMcpKey'), 'undefined');
  await click('Закрыть');
  const checked = await js(`window.studio.checkResource('protected-http')`);
  assert.equal(checked.status, 'available');
  assert.equal(checked.toolCount, 1);
  assert.ok(authorized > 0);
  const login = await js(`window.studio.openResourceLogin('protected-http')`);
  assert.equal(login.opened, false);
  assert.ok(login.next.includes('Защищённые параметры'));
  await rowAction('stdio', 'Защищённые параметры');
  await until(`!!document.querySelector('[aria-label="Значение STDIO_KEY"]')`);
  await value('STDIO_KEY', stdioKey);
  await click('Сохранить параметры');
  await until(`document.querySelector('.dialog-body')?.innerText.includes('Параметры сохранены')`);
  await click('Закрыть');
  const stdioChecked = await js(`window.studio.checkResource('protected-stdio')`);
  assert.equal(stdioChecked.status, 'available');
  assert.equal(stdioChecked.toolCount, 1);
  assert.equal(
    process.env.SERVICE_TOKEN,
    undefined,
    'MCP secret must not enter the app/global environment',
  );
  for (const path of [join(studio, '.pistudio/studio.json'), join(native, 'mcp.json')]) {
    const bytes = await readFile(path, 'utf8');
    assert.equal(bytes.includes(httpKey), false);
    assert.equal(bytes.includes(stdioKey), false);
  }
  for (const file of await readdir(join(userData, 'mcp-secrets'))) {
    const bytes = await readFile(join(userData, 'mcp-secrets', file), 'utf8');
    assert.equal(bytes.includes(httpKey), false);
    assert.equal(bytes.includes(stdioKey), false);
  }
  await rowAction('http', 'Защищённые параметры');
  await until(
    `document.querySelector('.dialog-body')?.textContent.includes('HTTP_KEY · сохранён')`,
  );
  await click('Удалить сохранённые параметры');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await click('Отмена');
  assert.equal(
    (await js(`window.studio.readMcpSecretStatus(${JSON.stringify(request)})`)).hasSavedValues,
    true,
  );
  await click('Удалить сохранённые параметры');
  await click('Удалить');
  await until(
    `document.querySelector('.dialog-body')?.textContent.includes('Сохранённые значения удалены')`,
  );
  assert.equal(
    (await js(`window.studio.readMcpSecretStatus(${JSON.stringify(request)})`)).hasSavedValues,
    false,
  );
  await assert.rejects(js(`window.studio.checkResource('protected-http')`));
  await mkdir(resolve('artifacts'), { recursive: true });
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile(resolve('artifacts/mcp-secrets-smoke.png'), (await window.capturePage()).toPNG());
  console.log(
    'MCP secrets Electron passed: real macOS encryption, empty password reopen, no getter/plaintext/global env, native HTTP and stdio authenticate with exact literal keys including $/!, confirmation/cancel/delete and no fallback.',
  );
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server?.closeAllConnections();
  server?.close();
  if (temporary)
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  app.exit(1);
});
