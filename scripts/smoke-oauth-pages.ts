import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { BrowserAuth, resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import { oauthPresentation } from '../src/main/pi/oauthPresentation.ts';
import { installOAuthPage, oauthErrorHtml } from '../bundled/pi-bridge/oauth-page.mjs';

// Native callback implementation, synthetic local codes only. No account, browser consent,
// token store, LLM request, system Chrome, Electron or desktop permissions are used.
const pi = await checkPi('');
const sdkPath = await resolvePiSdk(await realpath(pi.path));
const nativePage = new URL(
  '../node_modules/@earendil-works/pi-ai/dist/utils/oauth-page.js',
  pathToFileURL(sdkPath),
);
const originalPage = await readFile(nativePage);
await changeLanguage('en');
const hook = installOAuthPage(oauthPresentation());
const { startOAuthCallbackServer } = await import(
  new URL('../auth/oauth/callback-server.js', nativePage).href
);
const pages = new Map();
let completed = 0;
for (const language of ['ru', 'en'] as const) {
  await changeLanguage(language);
  const labels = oauthPresentation();
  const localHook = installOAuthPage(labels);
  try {
    const callback = await startOAuthCallbackServer({
      providerName: 'Synthetic provider',
      host: '127.0.0.1',
      port: 0,
      path: '/callback',
      state: 'fixture-state',
      complete: async (code) => {
        completed++;
        return code;
      },
    });
    try {
      for (const [query, status, message] of [
        ['?state=wrong&code=fixture', 400, labels.invalidState],
        ['?state=fixture-state', 400, labels.missingCode],
      ] as const) {
        const response = await fetch(callback.redirectUri + query);
        assert.equal(response.status, status);
        assert.ok((await response.text()).includes(message));
        assert.equal(completed, language === 'ru' ? 0 : 1);
      }
      const response = await fetch(callback.redirectUri + '?state=fixture-state&code=fixture-code');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.ok(html.includes(labels.returnTitle));
      assert.ok(html.includes(labels.returnMessage));
      assert.ok(html.includes(`lang="${language}"`));
      assert.ok(html.includes('data:image/png;base64,'));
      assert.ok(!html.includes('Synthetic provider'));
      assert.ok(!html.includes('fixture-code'));
      assert.equal(await callback.wait(), 'fixture-code');
      pages.set(`${language}-success`, html);
      const repeated = await fetch(callback.redirectUri + '?state=fixture-state&code=fixture-code');
      assert.equal(repeated.status, 409);
      assert.ok((await repeated.text()).includes(labels.alreadyHandled));
    } finally {
      callback.close();
    }
    const failure = await startOAuthCallbackServer({
      providerName: 'Synthetic provider',
      host: '127.0.0.1',
      port: 0,
      path: '/callback',
      state: 'fixture-state',
      complete: async () => {
        throw new Error('fixture-secret-token <script>untrusted()</script>');
      },
    });
    try {
      const response = await fetch(failure.redirectUri + '?state=fixture-state&code=fixture-code');
      assert.equal(response.status, 502);
      const html = await response.text();
      assert.ok(html.includes(labels.errorTitle));
      assert.ok(!html.includes('fixture-secret'));
      assert.ok(!html.includes('<script'));
      await assert.rejects(failure.wait());
      pages.set(`${language}-error`, html);
    } finally {
      failure.close();
    }
    // Provider-controlled strings stay out of the browser document, even when escaped.
    assert.ok(
      !oauthErrorHtml('<img src=https://example.com>', 'fixture-secret').includes('example.com'),
    );
  } finally {
    localHook.deregister();
  }
}
assert.equal(completed, 2);
assert.deepEqual(
  await readFile(nativePage),
  originalPage,
  'Installed Pi files must stay unchanged',
);
hook.deregister();

const root = await mkdtemp(join(tmpdir(), 'pistudio-oauth-pages-'));
const output = resolve('artifacts/oauth-pages');
await mkdir(output, { recursive: true });
const server = createServer((request, response) => {
  const page = pages.get(new URL(request.url!, 'http://localhost').pathname.slice(1));
  response.writeHead(page ? 200 : 404, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(page ?? '');
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address() as { port: number };
let browser, socket;
try {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'native-pi');
  const auth = new BrowserAuth(resolve('bundled/pi-bridge/login.mjs'), async (url) => {
    assert.ok(['auth.openai.com', 'claude.ai'].includes(new URL(url).hostname));
    handedOff = true;
  });
  let handedOff = false;
  try {
    for (const provider of ['openai-codex', 'anthropic']) {
      handedOff = false;
      const state = await auth.startProvider(pi.path, {
        key: provider,
        provider,
        method: 'oauth',
        cwd: root,
        scope: { provider, authPath: join(root, `${provider}-auth.json`) },
        verify: async () => false,
      });
      for (let i = 0; i < 200 && !handedOff; i++) {
        const next = auth.read(state.id);
        assert.notEqual(next.phase, 'error', next.message);
        if (next.prompt?.options?.some((option) => option.id === 'browser'))
          auth.answer(state.id, next.prompt.id, 'browser');
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(handedOff, true, `${provider} must reach its official browser handoff`);
      auth.cancel(state.id);
      assert.equal(auth.read(state.id).phase, 'cancelled');
    }
  } finally {
    auth.close();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  const executable =
    process.env.PISTUDIO_QA_CHROME ||
    join(
      homedir(),
      'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    );
  assert.ok(!executable.includes('/Applications/'));
  browser = spawn(
    executable,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${join(root, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-breakpad',
      '--no-sandbox',
      '--use-mock-keychain',
      '--password-store=basic',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise<string>((done, fail) => {
    let log = '';
    const timer = setTimeout(() => fail(Error('Headless startup timed out')), 15000);
    browser.on('error', fail);
    browser.stderr!.on('data', (data) => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, fail) => {
    socket!.onopen = done;
    socket!.onerror = fail;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  };
  const send = (method, params = {}, sessionId?) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000);
      pending.set(id, { resolve, reject, timer });
      socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params = {}) => send(method, params, sessionId);
  await cdp('Page.enable');
  const results = [];
  for (const language of ['ru', 'en'])
    for (const theme of ['light', 'dark'])
      for (const kind of ['success', 'error']) {
        await cdp('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: theme }],
        });
        await cdp('Emulation.setDeviceMetricsOverride', {
          width: 920,
          height: 640,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp('Page.navigate', { url: `http://127.0.0.1:${address.port}/${language}-${kind}` });
        const expression = `({language:document.documentElement.lang,heading:document.querySelector('h1')?.textContent,logo:!!document.images[0]?.complete&&document.images[0]?.naturalWidth>0,width:document.documentElement.scrollWidth,background:getComputedStyle(document.documentElement).backgroundColor,scripts:document.scripts.length,links:document.querySelectorAll('a,input,form,button').length})`;
        let state;
        for (let i = 0; i < 100; i++) {
          state = (await cdp('Runtime.evaluate', { expression, returnByValue: true })).result.value;
          if (state.language === language && state.logo) break;
          await new Promise((done) => setTimeout(done, 30));
        }
        assert.equal(state.language, language);
        assert.equal(state.logo, true);
        assert.equal(state.scripts, 0);
        assert.equal(state.links, 0);
        assert.ok(state.width <= 920);
        assert.equal(
          state.background,
          theme === 'light' ? 'rgb(248, 249, 251)' : 'rgb(23, 23, 23)',
        );
        await changeLanguage(language as 'ru' | 'en');
        assert.equal(
          state.heading,
          kind === 'success' ? oauthPresentation().returnTitle : oauthPresentation().errorTitle,
        );
        const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
        await writeFile(
          join(output, `${language}-${theme}-${kind}.png`),
          Buffer.from(screenshot.data, 'base64'),
        );
        await cdp('Emulation.setDeviceMetricsOverride', {
          width: 320,
          height: 568,
          deviceScaleFactor: 1,
          mobile: true,
        });
        const narrow = await cdp('Runtime.evaluate', {
          expression:
            'document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").getBoundingClientRect().bottom <= innerHeight',
          returnByValue: true,
        });
        assert.equal(narrow.result.value, true, 'Narrow page must fit');
        results.push({ language, theme, kind, heading: state.heading, narrowFits: true });
      }
  await writeFile(
    join(output, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        nativePi: '1.5.2',
        callbackValidationPreserved: true,
        installedSdkUnchanged: true,
        providerDetailsHidden: true,
        results,
        limits:
          'Synthetic local callback and isolated headless rendering only; no real account login or native Windows acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Native OAuth callback checks and RU/EN × light/dark × success/error pages passed; installed SDK unchanged.',
  );
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise((done) => browser!.once('exit', done));
    browser.kill();
    await closed;
  }
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
