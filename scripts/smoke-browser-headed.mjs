import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { BrowserSession } from '../bundled/pi-bridge/browser/BrowserSession.mjs';
import { evaluated } from '../bundled/pi-bridge/browser/browserPreferences.mjs';
import { readChrome } from '../src/main/browser/installChrome.ts';
import { readAgentBrowser } from '../src/main/browser/installAgentBrowser.ts';
import { AGENT_BROWSER_VERSION } from '../src/main/browser/browserVersions.ts';

const [runtime, fullRoot] = process.argv.slice(2);
assert.ok(
  runtime && fullRoot,
  'Pass the existing runtime root and an installer-verified full Chrome root.',
);
const binary = await readAgentBrowser(join(runtime, `agent-browser-${AGENT_BROWSER_VERSION}`));
const chrome = await readChrome(fullRoot, true);
assert.ok(binary && chrome);
const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-headed-'));
const output = join(root, 'output');
await mkdir(output);
let clicks = 0,
  proxyRequests = 0;
const html =
  '<!doctype html><style>body{margin:0;background:#f4f1e7;font:20px system-ui}button{position:absolute;left:100px;top:100px;width:200px;height:80px}</style><h1>Private Browser Use fixture</h1><button onclick="fetch(\'/clicked\')">Click fixture</button>';
const server = createServer((request, response) => {
  if (request.url === '/clicked') clicks++;
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
const proxy = createServer((request, response) => {
  proxyRequests++;
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
const binding = {
  scope: 'headed-qa',
  sessions: join(root, 'sessions'),
  binary,
  chrome,
  headedChrome: chrome,
  visual: true,
  projectRoot: root,
  outputRoot: output,
};
const browsers = [];
try {
  // Full Chrome stays genuinely headless: this test must never show windows or steal focus.
  const browser = new BrowserSession(binding, 'yellow-live-cursor');
  browsers.push(browser);
  await browser.call('browser_open', {
    url: `http://127.0.0.1:${server.address().port}`,
    headed: false,
  });
  assert.equal(JSON.parse(await readFile(browser.config, 'utf8')).headed, false);
  // Exercise the production headed-only cursor method on this hidden page. Launch config stays false.
  browser.headed = true;
  await browser.cursor({ x: 200, y: 140 }, true);
  const state = evaluated(
    await browser.invoke('agent_browser_eval', {
      script: `(() => {
    const state=globalThis.__piStudioBrowserCursor;
    return {width:innerWidth,height:innerHeight,fill:state.shadow.querySelector('svg').getAttribute('fill'),
      inert:state.host.hasAttribute('inert'),ariaHidden:state.host.getAttribute('aria-hidden'),
      pointerEvents:getComputedStyle(state.host).pointerEvents};
  })()`,
    }),
  );
  assert.equal(state.fill, '#f2cc43');
  assert.equal(state.inert, true);
  assert.equal(state.ariaHidden, 'true');
  assert.equal(state.pointerEvents, 'none');
  const shot = await browser.call('browser_click', { x: 200, y: 140 });
  assert.equal(clicks, 1, 'The yellow overlay must not intercept input.');
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/browser-yellow-cursor-preview.png',
    Buffer.from(shot.content.find((item) => item.type === 'image').data, 'base64'),
  );
  const nativeInspect = await browser.call('browser_devtools', {});
  assert.ok(
    nativeInspect.content.length,
    'DevTools target can be opened in the owned headless test browser.',
  );
  const viaProxy = new BrowserSession({ ...binding, scope: 'proxy-qa' }, 'proxy');
  browsers.push(viaProxy);
  await viaProxy.call('browser_open', {
    url: 'http://pi-studio-fixture.invalid',
    proxy: `http://127.0.0.1:${proxy.address().port}`,
  });
  assert.ok(proxyRequests > 0, 'The explicitly configured HTTP proxy must receive the request.');
  // Verify real full executable + production config generation for headed mode without launching it.
  const configOnly = new BrowserSession({ ...binding, scope: 'headed-config-only' }, 'config');
  browsers.push(configOnly);
  configOnly.headed = true;
  await configOnly.prepare();
  const config = JSON.parse(await readFile(configOnly.config, 'utf8'));
  assert.equal(config.headed, true);
  assert.equal(config.executablePath, chrome);
  assert.equal(configOnly.opened, false);
  await writeFile(
    'artifacts/browser-headed-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        backend: AGENT_BROWSER_VERSION,
        fullChromeInstallerVerified: true,
        fullChromeUsedHeadlessForQa: true,
        yellowLiveCursor: true,
        cursorClickThrough: true,
        isolatedDevTools: true,
        upstreamInspectAvoided: true,
        actualHttpProxy: true,
        actualHeadedConfig: true,
        headedModeRenderedOnDesktop: false,
        manualAccountLogin: false,
        personalBrowserUsed: false,
        modelRequests: 0,
        limits:
          'No visible native browser/window acceptance or real external account login. QA exercises the headed cursor code on a hidden full-Chrome page; the headed launch itself is configuration-verified only. Upstream recorded cursor retains its own color.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Full Chrome, yellow page cursor/click-through, owned DevTools, HTTP proxy and headed config passed; no visible windows.',
  );
} finally {
  await Promise.allSettled(browsers.map((browser) => browser.close()));
  await new Promise((done) => server.close(done));
  await new Promise((done) => proxy.close(done));
  await rm(root, { recursive: true, force: true });
}
