import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../bundled/pi-bridge/browser/BrowserSession.mjs';
import { BrowserSessions } from '../bundled/pi-bridge/browser/BrowserSessions.mjs';
import { proxyUrl } from '../bundled/pi-bridge/browser/browserPreferences.mjs';
import { validateBrowserCall } from '../bundled/pi-bridge/browser/tools.mjs';
import { chromeArchive, visibleChromeArchives } from '../src/main/browser/browserVersions.ts';
import { openDevTools } from '../bundled/pi-bridge/browser/openDevTools.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-features-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output'));
  const binary = join(root, 'binary');
  await writeFile(binary, 'fixture');
  const binding = {
    scope: 'studio/project/agent',
    sessions: root,
    visual: true,
    binary,
    chrome: binary,
    headedChrome: binary,
    projectRoot: root,
    outputRoot: join(root, 'output'),
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  function session(value = binding) {
    const browser = new BrowserSession(value, 'canonical');
    browser.invoke = async (name, args = {}) => {
      calls.push({ name, args });
      browser.opened = name !== 'agent_browser_close';
      if (name === 'agent_browser_state_save') await writeFile(args.path, '{}');
      if (name === 'agent_browser_screenshot') {
        const png = Buffer.alloc(24);
        Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
        png.writeUInt32BE(1280, 16);
        png.writeUInt32BE(800, 20);
        await writeFile(args.path, png);
        return {
          content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }],
        };
      }
      if (name === 'agent_browser_eval')
        return { content: [{ type: 'text', text: JSON.stringify({ width: 1280, height: 800 }) }] };
      if (args.path && name !== 'agent_browser_state_save' && name !== 'agent_browser_state_load')
        await writeFile(args.path, 'fixture artifact');
      return { content: [{ type: 'text', text: '{}' }] };
    };
    return browser;
  }
  return { root, binding, calls, session };
}

test('headed launch is explicit, private, persistent and never silently restarts an existing browser', async (t) => {
  const f = await fixture(t),
    browser = f.session();
  await browser.call('browser_open', {
    url: 'https://example.com',
    headed: true,
    proxy: 'http://localhost:8080',
  });
  const config = JSON.parse(await readFile(browser.config, 'utf8'));
  assert.equal(config.headed, true);
  assert.equal(config.executablePath, f.binding.headedChrome);
  assert.equal(config.profile, join(browser.root, 'profile'));
  assert.equal(config.proxy, 'http://localhost:8080');
  assert.ok(
    f.calls.some(
      (call) => call.name === 'agent_browser_eval' && String(call.args.script).includes('#f2cc43'),
    ),
  );
  const before = f.calls.length;
  await assert.rejects(
    browser.call('browser_open', { url: 'https://example.com', headed: false }),
    /browser_close/,
  );
  assert.equal(f.calls.length, before);
  await browser.call('browser_close', {});
  assert.equal(browser.opened, false);
  const resumed = f.session();
  await resumed.call('browser_open', { url: 'https://example.com' });
  assert.equal(JSON.parse(await readFile(resumed.config, 'utf8')).headed, true);
  assert.equal(JSON.parse(await readFile(resumed.config, 'utf8')).proxy, 'http://localhost:8080');
  await resumed.close();
  assert.equal(await readFile(join(browser.root, 'web-state.json'), 'utf8'), '{}');
});

test('MCP named sessions isolate profiles, persist selection and never select a foreign/missing name', async (t) => {
  const f = await fixture(t),
    browsers = new BrowserSessions(f.binding, 'canonical', f.session);
  await browsers.call('browser_session', { action: 'list' });
  assert.equal(f.calls.length, 0);
  await browsers.call('browser_session', { action: 'create', name: 'Работа' });
  const firstRoot = browsers.default.root,
    secondRoot = browsers.session('Работа').root;
  assert.notEqual(firstRoot, secondRoot);
  await assert.rejects(
    browsers.call('browser_session', { action: 'switch', name: 'missing' }),
    /не найдена/,
  );
  await assert.rejects(
    browsers.call('browser_session', { action: 'create', name: 'Работа' }),
    /уже существует/,
  );
  const resumed = new BrowserSessions(f.binding, 'canonical', f.session);
  assert.match(
    (await resumed.call('browser_session', { action: 'current' })).content[0].text,
    /Работа/,
  );
  const foreign = new BrowserSessions(
    { ...f.binding, scope: 'other-agent' },
    'canonical',
    f.session,
  );
  assert.doesNotMatch(
    (await foreign.call('browser_session', { action: 'list' })).content[0].text,
    /Работа/,
  );
  await assert.rejects(
    foreign.call('browser_session', { action: 'switch', name: 'Работа' }),
    /не найдена/,
  );
  const active = browsers.session('Работа');
  active.observed = true;
  await browsers.call('browser_session', { action: 'switch', name: 'default' });
  assert.equal(active.observed, false);
  assert.equal(f.calls.length, 0, 'Management does not launch browsers.');
});

test('diagnostics/emulation/export are scoped and recordings always force cursor:true', async (t) => {
  const f = await fixture(t),
    browser = f.session();
  await browser.call('browser_open', { url: 'https://example.com' });
  for (const action of ['console', 'errors', 'requests'])
    await browser.call('browser_diagnostics', { action });
  await browser.call('browser_diagnostics', { action: 'request', requestId: 'request-1' });
  await browser.call('browser_emulate', { action: 'geolocation', latitude: 43, longitude: 76 });
  await browser.call('browser_emulate', { action: 'offline', enabled: false });
  await browser.call('browser_emulate', { action: 'theme', colorScheme: 'dark' });
  await browser.call('browser_capture', { format: 'pdf', output: 'page.pdf' });
  assert.equal(await readFile(join(f.root, 'output/page.pdf'), 'utf8'), 'fixture artifact');
  await assert.rejects(
    browser.call('browser_capture', { format: 'pdf', output: 'page.pdf' }),
    /EEXIST/,
  );
  await assert.rejects(browser.call('browser_capture', { format: 'pdf', output: '../escape' }));
  await browser.call('browser_record', { action: 'start', output: 'record.webm' });
  const record = f.calls.find((call) => call.name === 'agent_browser_record_start');
  assert.equal(record?.args.cursor, true);
  await assert.rejects(
    browser.call('browser_record', { action: 'start', output: 'again.webm' }),
    /Предыдущая запись/,
  );
  await assert.rejects(browser.call('browser_close', {}), /Сначала остановите/);
  await browser.call('browser_record', { action: 'stop' });
  assert.equal(await readFile(join(f.root, 'output/record.webm'), 'utf8'), 'fixture artifact');
  await browser.close();
  assert.ok(
    (await readdir(browser.root)).includes('profile') === false,
    'Fixture never starts an actual browser.',
  );
});

test('browser schemas reject launches/config escapes and invalid emulation/proxy before dispatch', () => {
  for (const args of [
    { headed: 'yes' },
    { cdp: '9222' },
    { profile: '/personal' },
    { cursor: false },
  ])
    assert.throws(() =>
      validateBrowserCall('browser_open', { url: 'https://example.com', ...args }),
    );
  assert.throws(() => validateBrowserCall('browser_emulate', { action: 'viewport', width: 400.5 }));
  assert.throws(() =>
    validateBrowserCall('browser_emulate', { action: 'geolocation', latitude: 91 }),
  );
  assert.throws(() => validateBrowserCall('browser_record', { action: 'start', fps: 0 }));
  assert.throws(() =>
    validateBrowserCall('browser_click', { x: 400, y: 20 }, { width: 400, height: 700 }),
  );
  for (const value of [
    'file:///x',
    'http://user:password@proxy:8080',
    'http://proxy/path',
    'http://proxy?key=secret',
  ])
    assert.throws(() => proxyUrl(value));
  assert.equal(proxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  for (const arch of ['arm64', 'x64'])
    assert.equal(chromeArchive(arch, 'darwin', true).integrity, visibleChromeArchives[arch]);
  assert.throws(() => chromeArchive('x64', 'win32', true), /только на Mac/);
});

test('DevTools only creates a target over the owned loopback CDP; upstream inspect and OS opening are never called', async (t) => {
  const original = globalThis.WebSocket;
  const commands: unknown[] = [],
    calls: string[] = [];
  class Socket {
    listeners = new Map();
    constructor(url) {
      assert.equal(url, 'ws://127.0.0.1:9222/devtools/browser/fixture');
      queueMicrotask(() => this.listeners.get('open')?.());
    }
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }
    send(message) {
      commands.push(JSON.parse(message));
      queueMicrotask(() =>
        this.listeners.get('message')?.({
          data: JSON.stringify({ id: 1, result: { targetId: 'devtools' } }),
        }),
      );
    }
    close() {}
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const browser = {
    invoke: async (name) => {
      calls.push(name);
      return {
        structuredContent: {
          response: {
            data:
              name === 'agent_browser_get_cdp_url'
                ? { cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/fixture' }
                : { tabs: [{ active: true, targetId: 'exact-page' }] },
          },
        },
      };
    },
  };
  await openDevTools(browser);
  assert.deepEqual(calls, ['agent_browser_get_cdp_url', 'agent_browser_tab_list']);
  assert.equal((commands[0] as { method: string }).method, 'Target.createTarget');
  assert.equal(
    (commands[0] as { params: { url: string } }).params.url,
    'devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9222/devtools/page/exact-page',
  );
  await assert.rejects(
    openDevTools({
      invoke: async (name) => ({
        structuredContent: {
          response: {
            data:
              name === 'agent_browser_get_cdp_url'
                ? { cdpUrl: 'ws://remote.example/devtools/browser/foreign' }
                : { tabs: [{ active: true, targetId: 'page' }] },
          },
        },
      }),
    }),
  );
  assert.equal(commands.length, 1);
});
