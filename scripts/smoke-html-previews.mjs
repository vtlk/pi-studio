import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import en from '../src/shared/i18n/en.json' with { type: 'json' };
import ru from '../src/shared/i18n/ru.json' with { type: 'json' };

// Uses only the installed, isolated headless shell. Never launches the system browser or Electron.
const executable =
  process.env.PISTUDIO_QA_CHROME ||
  join(
    homedir(),
    'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  );
if (executable.includes('/Applications/')) throw Error('QA must not launch the system browser');
const root = await mkdtemp(join(tmpdir(), 'pistudio-html-preview-'));
const webRoot = resolve('out/renderer');
let probes = 0;
const server = createServer(async (request, response) => {
  try {
    if (new URL(request.url, 'http://localhost').pathname === '/html-probe') probes++;
    const path = resolve(
      webRoot,
      '.' + new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'),
    );
    if (!path.startsWith(webRoot + sep)) throw Error('scope');
    const bytes = await readFile(path);
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ||
        'application/octet-stream',
    );
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser, socket;
const errors = [];
try {
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
  const address = await new Promise((done, fail) => {
    let log = '';
    const timer = setTimeout(() => fail(Error('Headless startup timed out: ' + log)), 15000);
    browser.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    browser.once('exit', (code) => {
      clearTimeout(timer);
      fail(Error(`Headless shell exited before startup (${code}): ${log}`));
    });
    browser.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    browser.on('exit', (code) => {
      clearTimeout(timer);
      fail(Error(`Headless exited ${code}: ${log}`));
    });
  });
  socket = new WebSocket(address);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error(`CDP timed out: ${method}`));
      }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(
        JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 840,
    deviceScaleFactor: 1,
    mobile: false,
  });
  function fixture() {
    const params = new URL(location.href).searchParams;
    const language = params.get('language') || 'ru';
    let theme = params.get('theme') || 'light';
    const folder = '/isolated-navigation-' + (params.get('studio') || 'A');
    const agents = ['a', 'b'].map((id) => ({
      id,
      name: 'Agent ' + id,
      enabled: true,
      skills: [],
      mcps: ['pistudio-project'],
      plugins: [],
      instructions: [],
    }));
    const teams = agents.map((agent) => ({
      id: 'team-' + agent.id,
      name: 'Team ' + agent.id,
      agentIds: [agent.id],
    }));
    const projects = agents.map((profile, index) => ({
      id: 'project-' + profile.id,
      name: 'Project ' + profile.id,
      folderName: 'project-' + profile.id,
      sourceTeamId: teams[index].id,
      createdAt: index + 1,
      agents: [{ profile, outputPath: 'agents/' + profile.id + '/output', entries: [] }],
    }));
    const isWindows = params.get('platform') === 'win32';
    Object.defineProperty(navigator, 'platform', { value: isWindows ? 'Win32' : 'MacIntel' });
    const prefix = 'agents/a/output/';
    const name = 'a-page-with-a-very-long-filename-that-needs-truncation.html';
    const probe = location.origin + '/html-probe';
    const attack = `<script>window.PREVIEW_EVIL=true;parent.PREVIEW_EVIL=true;fetch('${probe}');</script><meta http-equiv="refresh" content="0;url=${probe}"><iframe src="${probe}"></iframe><object data="${probe}"></object><input type="file"><button>Inert form button</button><img src="${probe}" onerror="parent.PREVIEW_EVIL=true"><a href="${probe}" target="_blank" ping="${probe}">bad link</a><style>@import url('${probe}');.bad{background-image:url('${probe}')}</style><svg><foreignObject><iframe src="${probe}"></iframe></foreignObject><a href="${probe}"><text>bad svg link</text></a><set attributeName="href" to="${probe}"></set></svg>`;
    const contents = {
      [prefix + name]:
        `<!doctype html><html><head><link rel="stylesheet" href="theme.css"><style>#inline{color:rgb(15,125,25)}</style></head><body><h1 class="banner">LOCAL_HTML_OK</h1><p id="inline">INLINE_CSS_OK</p><img id="local-logo" src="logo.svg">${attack}</body></html>`,
      [prefix + 'theme.css']:
        `.banner{background:rgb(30,70,110);color:white;padding:20px}:root{--hostile:'</style><meta http-equiv="refresh" content="0;url=${probe}"><script>parent.PREVIEW_EVIL=true</script>'}`,
      [prefix + 'logo.svg']:
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="orange"/></svg>',
      [prefix + 'other.txt']: 'OTHER_FILE_NOT_SELECTED',
      [prefix + 'nested/data.txt']: 'NESTED_FILE',
    };
    const makeFile = (path) => ({
      kind: 'file',
      id: path,
      diskPath: path,
      name: path.split('/').pop(),
      format: path.endsWith('.svg') ? 'image' : 'text',
      content: contents[path],
      size: contents[path].length,
      fingerprint: 'qa-v1',
    });
    projects[0].agents[0].entries = [
      makeFile(prefix + name),
      makeFile(prefix + 'theme.css'),
      makeFile(prefix + 'logo.svg'),
      makeFile(prefix + 'other.txt'),
      {
        kind: 'folder',
        id: prefix + 'nested',
        name: 'nested',
        children: [makeFile(prefix + 'nested/data.txt')],
      },
    ];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (String(url).startsWith('studio-media://')) {
        const parsed = new URL(String(url));
        const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (parts.shift() !== 'project-a' || parts.join('/') !== prefix + 'logo.svg')
          throw Error('Unexpected media scope');
        return new Response(contents[prefix + 'logo.svg'], {
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      return originalFetch(url, options);
    };
    const state = {
      folder,
      sections: {
        agentCatalog: { agents, teams },
        systemAgents: [],
        resources: [],
        connections: [],
      },
      projects,
      trashProjects: [],
      warnings: [],
    };
    const calls = { launch: 0, commands: 0, saves: 0 };
    const clone = (value) => structuredClone(value);
    window.__qa = { state, calls, reveals: [], reads: [], name, prefix };
    window.studio = new Proxy(
      {
        getInfo: async () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
        getLanguage: async () => ({ language, preference: language, revision: 0 }),
        getTheme: async () => ({ theme, preference: theme, revision: 0 }),
        setTheme: async (value) => ({ theme: (theme = value), preference: value, revision: 1 }),
        getUpdateState: async () => ({ phase: 'idle', currentVersion: 'QA' }),
        getStartup: async () => ({ phase: 'ready', message: 'QA' }),
        getGitHubStar: async () => ({
          due: false,
          disabled: false,
          revision: 0,
          canPresent: false,
        }),
        getOnboardingReadiness: async () => ({
          folder,
          terminal: 'ready',
          git: 'ready',
          connections: {},
          mcps: {},
        }),
        listPiProcesses: async () => [],
        listTeamImports: async () => [],
        listProjectUsage: async () => [],
        listProjectActivity: async () => [],
        listTeamMessages: async () => [],
        loadStudio: async () => clone(state),
        readProject: async (id) => clone(projects.find((project) => project.id === id)),
        readOutput: async ({ projectId, path }) => {
          window.__qa.reads.push({ projectId, path });
          if (projectId !== 'project-a' || !(path in contents))
            throw Error('Invalid QA file scope');
          return clone(makeFile(path));
        },
        revealOutput: async (request) => {
          window.__qa.reveals.push(clone(request));
        },
        prepareAgentRefresh: async ({ projectId }) => ({
          projectId,
          revision: 'qa',
          added: [],
          removed: [],
          changed: [],
          restarting: [],
          removing: [],
        }),
        saveSection: async (key, value) => {
          calls.saves++;
          state.sections[key] = clone(value);
          return { saved: true, value };
        },
        launchAgent: async () => {
          calls.launch++;
          throw Error('No Pi work is authorized by navigation');
        },
        projectCommand: async () => {
          calls.commands++;
          throw Error('Navigation must not mutate projects');
        },
      },
      {
        get(target, key) {
          if (String(key).startsWith('on')) return () => () => {};
          if (key in target) return target[key];
          return async () => {
            throw Error('Unexpected QA API: ' + String(key));
          };
        },
      },
    );
  }
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})();` });
  const js = async (expression) => {
    const value = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (value.exceptionDetails)
      throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  const until = async (expression) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await js(expression)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw Error(
      'UI condition failed: ' +
        expression +
        '\n' +
        (await js('document.body.innerText')) +
        '\n' +
        errors.join('\n'),
    );
  };
  const click = async (selector) => {
    assert.ok(await js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const visit = async (language, theme, studio = 'A', platform = 'darwin') => {
    await cdp('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/?language=${language}&theme=${theme}&studio=${studio}&platform=${platform}`,
    });
    await until(`!!document.querySelector('.project-list-row')`);
  };
  const checks = [];
  const frameJs = async (expression) => {
    const tree = await cdp('Page.getFrameTree');
    const frame = tree.frameTree.childFrames?.find((child) => child.frame.url === 'about:srcdoc');
    assert.ok(frame, 'Sandboxed document frame exists');
    const world = await cdp('Page.createIsolatedWorld', {
      frameId: frame.frame.id,
      worldName: 'qa-read-only-inspection',
      grantUniveralAccess: false,
    });
    const value = await cdp('Runtime.evaluate', {
      expression,
      contextId: world.executionContextId,
      returnByValue: true,
    });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.text);
    return value.result.value;
  };
  for (const language of ['ru', 'en'])
    for (const theme of ['light', 'dark'])
      for (const platform of ['darwin', 'win32']) {
        const messages = language === 'ru' ? ru : en;
        await visit(language, theme, 'A', platform);
        await js(
          `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('Project a')).click()`,
        );
        await until(`!!document.querySelector('.file-tree-file-row')`);
        await js(
          `Array.from(document.querySelectorAll('.file-tree-file-row .file-tree-item')).find(button=>button.textContent.includes(window.__qa.name)).click()`,
        );
        await until(`!!document.querySelector('.html-preview-frame')`);
        // Let a malicious meta refresh or stylesheet request surface if it escaped the boundary.
        await new Promise((done) => setTimeout(done, 250));
        assert.equal(
          await js(`document.querySelector('.html-preview-frame').getAttribute('sandbox')`),
          '',
        );
        assert.equal(
          await js(`document.querySelector('.html-preview-frame').contentDocument`),
          null,
          'Opaque origin blocks host DOM access',
        );
        assert.equal(await js(`typeof window.PREVIEW_EVIL`), 'undefined');
        assert.equal(await frameJs(`typeof window.PREVIEW_EVIL`), 'undefined');
        assert.equal(await frameJs(`typeof window.studio`), 'undefined', 'No preload/IPC bridge');
        assert.equal(
          await frameJs(`document.querySelector('.banner').textContent`),
          'LOCAL_HTML_OK',
        );
        assert.equal(
          await frameJs(`getComputedStyle(document.querySelector('.banner')).backgroundColor`),
          'rgb(30, 70, 110)',
        );
        assert.equal(
          await frameJs(`getComputedStyle(document.querySelector('#inline')).color`),
          'rgb(15, 125, 25)',
        );
        assert.equal(await frameJs(`document.querySelector('#local-logo').naturalWidth`), 40);
        assert.equal(
          await frameJs(
            `!!document.querySelector('script,iframe,object,embed,meta[http-equiv="refresh"],form,base')`,
          ),
          false,
        );
        assert.equal(await frameJs(`!!document.querySelector('a[href],[onerror],svg set')`), false);
        assert.equal(
          await frameJs(
            `Array.from(document.querySelectorAll('input,select,textarea,button')).every(control=>control.disabled)`,
          ),
          true,
        );
        assert.equal(
          probes,
          0,
          'No actual HTTP request from raw parsing, CSS, scripts, images or meta refresh',
        );
        const root = await js(
          `(()=>{const button=Array.from(document.querySelectorAll('.file-tree-file-row .file-tree-item')).find(b=>b.textContent.includes('other.txt'));const row=button.closest('li');window.__qa.revealRow=row;return {x:row.getBoundingClientRect().x+10,y:row.getBoundingClientRect().y+10};})()`,
        );
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1090, y: 20 });
        assert.equal(
          await js(
            `getComputedStyle(window.__qa.revealRow.querySelector('.file-tree-reveal')).opacity`,
          ),
          '0',
        );
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...root });
        await until(
          `getComputedStyle(window.__qa.revealRow.querySelector('.file-tree-reveal')).opacity==='1'`,
        );
        assert.equal(
          await js(
            `window.__qa.revealRow.querySelector('.file-tree-reveal').getAttribute('aria-label')`,
          ),
          messages[
            platform === 'win32' ? 'AgentActions.showInExplorer' : 'AgentActions.showInFinder'
          ],
        );
        await js(`window.__qa.revealRow.querySelector('.file-tree-reveal').click()`);
        await until(`window.__qa.reveals.length===1`);
        assert.deepEqual(await js('window.__qa.reveals[0]'), {
          projectId: 'project-a',
          path: 'agents/a/output/other.txt',
        });
        assert.equal(
          await frameJs(`document.querySelector('.banner').textContent`),
          'LOCAL_HTML_OK',
          'Reveal does not select another file',
        );
        assert.equal(
          await js(
            `(()=>{const row=Array.from(document.querySelectorAll('.file-tree-file-row')).find(row=>row.textContent.includes(window.__qa.name));const s=row.querySelector('.file-tree-item span');const b=row.querySelector('.file-tree-reveal');return s.scrollWidth>s.clientWidth&&getComputedStyle(s).textOverflow==='ellipsis'&&b.getBoundingClientRect().right<=row.getBoundingClientRect().right;})()`,
          ),
          true,
        );
        await js(
          `(()=>{const folder=document.querySelector('.file-tree-folder');if(folder.getAttribute('aria-expanded')==='false')folder.click();})()`,
        );
        await until(
          `Array.from(document.querySelectorAll('.file-tree-file-row')).some(row=>row.textContent.includes('data.txt'))`,
        );
        await js(
          `Array.from(document.querySelectorAll('.file-tree-file-row')).find(row=>row.textContent.includes('data.txt')).querySelector('.file-tree-reveal').focus()`,
        );
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1090, y: 20 });
        assert.equal(
          await js(`getComputedStyle(document.activeElement).opacity`),
          '0',
          'Selection or keyboard focus alone does not reveal the icon',
        );
        await js(`document.activeElement.click()`);
        await until(`window.__qa.reveals.length===2`);
        assert.deepEqual(await js('window.__qa.reveals[1]'), {
          projectId: 'project-a',
          path: 'agents/a/output/nested/data.txt',
        });
        if (platform === 'darwin') {
          const shot = await cdp('Page.captureScreenshot', { format: 'png' });
          await writeFile(
            `artifacts/html-preview-${language}-${theme}.png`,
            Buffer.from(shot.data, 'base64'),
          );
        }
        await js(
          `Array.from(document.querySelectorAll('.html-preview-toolbar button')).find(button=>button.textContent===${JSON.stringify(messages['HtmlPreview.source'])}).click()`,
        );
        await until(`!!document.querySelector('.html-preview .monaco-editor .view-lines')`);
        assert.equal(
          await js(
            `document.querySelector('.html-preview .view-lines').textContent.includes('<script>')`,
          ),
          true,
          'Raw source remains intact and inert',
        );
        assert.equal(await js(`!!document.querySelector('.html-preview-frame')`), false);
        await cdp('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'f',
          code: 'KeyF',
          modifiers: platform === 'win32' ? 2 : 4,
          windowsVirtualKeyCode: 70,
        });
        await cdp('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'f',
          code: 'KeyF',
          modifiers: platform === 'win32' ? 2 : 4,
          windowsVirtualKeyCode: 70,
        });
        await until(`!!document.querySelector('.html-preview .find-widget.visible')`);
        await cdp('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        await cdp('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        await until(`!document.querySelector('.html-preview .find-widget.visible')`);

        assert.deepEqual(await js('window.__qa.calls'), { launch: 0, commands: 0, saves: 0 });
        checks.push({
          language,
          theme,
          platform,
          staticCssAndLocalImages: true,
          sandboxOpaqueNoBridge: true,
          scriptsNavigationAndNetworkBlocked: true,
          sourceUnchanged: true,
          revealScopedAndIndependent: true,
          hoverOnlyEllipsisAndNestedFiles: true,
        });
      }
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    checks,
    actualProbeRequests: probes,
    nativeExplorerOrFinderOpened: false,
    userAppOrDataChanged: false,
    scope:
      'Actual compiled renderer + isolated headless shell; controlled native APIs and media transport. Not native Windows acceptance.',
  };
  await writeFile('artifacts/html-preview-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null) {
    const ended = new Promise((done) => browser.once('exit', done));
    browser.kill('SIGTERM');
    await ended;
  }
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}
