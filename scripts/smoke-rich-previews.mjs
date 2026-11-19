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
const root = await mkdtemp(join(tmpdir(), 'pistudio-rich-preview-'));
const webRoot = resolve('out/renderer');
let probes = 0;
for (const [name, size] of [
  ['portrait', '108x192'],
  ['landscape', '192x108'],
]) {
  await new Promise((done, fail) => {
    const child = spawn('/opt/homebrew/bin/ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=${size}:d=4:r=10`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      join(root, name + '.mp4'),
    ]);
    child.once('error', fail);
    child.once('exit', (code) => (code ? fail(Error('fixture encode failed')) : done()));
  });
}

const server = createServer(async (request, response) => {
  try {
    if (new URL(request.url, 'http://localhost').pathname === '/html-probe') probes++;
    if (/^\/qa-(portrait|landscape)\.mp4$/.test(request.url)) {
      response.setHeader('Content-Type', 'video/mp4');
      const bytes = await readFile(join(root, request.url.slice(4)));
      response.setHeader('Accept-Ranges', 'bytes');
      if (request.headers.range) {
        const [, from, to] = /bytes=(\d+)-(\d*)/.exec(request.headers.range);
        const start = Number(from),
          end = to ? Number(to) : bytes.length - 1;
        response.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': end - start + 1,
        });
        response.end(bytes.subarray(start, end + 1));
      } else {
        response.setHeader('Content-Length', bytes.length);
        response.end(bytes);
      }
      return;
    }
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
    projects[0].agents.push({ profile: agents[1], outputPath: 'agents/b/output', entries: [] });
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
      [prefix + 'pipeline.py']:
        'import os\n# PIPELINE_SOURCE\ndef run_pipeline():\n    return 42\n',
      [prefix + 'app.js']: 'export const steps = [1, 2, 3];',
      [prefix + 'layout.css']: '.scene { color: #ffd33d; transform: translateX(20px); }',
      [prefix + 'data.json']: '{"pipeline":true,"steps":[1,2,3]}',
      [prefix + 'portrait.mp4']: '',
      [prefix + 'landscape.mp4']: '',
      [prefix + 'other.txt']: 'OTHER_FILE_NOT_SELECTED',
      [prefix + 'nested/data.txt']: 'NESTED_FILE',
    };
    const makeFile = (path) => ({
      kind: 'file',
      id: path,
      diskPath: path,
      name: path.split('/').pop(),
      format: path.endsWith('.mp4')
        ? 'video'
        : path.endsWith('.svg')
          ? 'image'
          : path.endsWith('.json')
            ? 'json'
            : 'text',
      ...(path.endsWith('.mp4') ? { src: location.origin + '/qa-' + path.split('/').pop() } : {}),
      content: contents[path],
      size: contents[path].length,
      fingerprint: 'qa-v1',
    });
    projects[0].agents[0].entries = [
      ...['pipeline.py', 'layout.css', 'app.js', 'data.json', 'portrait.mp4', 'landscape.mp4'].map(
        (name) => makeFile(prefix + name),
      ),
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
    window.__qa = {
      state,
      calls,
      reveals: [],
      reads: [],
      name,
      prefix,
      delay: 0,
      processes: [
        {
          projectId: 'project-a',
          agentId: 'a',
          embedded: true,
          pid: 123,
          runId: 'run-a',
          agentName: 'Agent a',
          working: true,
        },
      ],
    };
    window.studio = new Proxy(
      {
        getInfo: async () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
        getLanguage: async () => ({ language, preference: language, revision: 0 }),
        getTheme: async () => ({ theme, preference: theme, revision: 0 }),
        setTheme: async (value) => ({ theme: (theme = value), preference: value, revision: 1 }),
        loadChatDrafts: async ({ folder }) => ({ folder, drafts: [] }),
        saveChatDraft: async ({ revision }) => ({ revision }),
        getUpdateState: async () => window.__qa.update ?? { phase: 'idle', currentVersion: 'QA' },
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
        listPiProcesses: async () => {
          const snapshot = clone(window.__qa.processes);
          if (window.__qa.delay) await new Promise((done) => setTimeout(done, window.__qa.delay));
          return snapshot;
        },
        getChat: async (target) => ({
          ...target,
          phase: 'ready',
          working: true,
          runId: 'run-' + target.agentId,
          revision: 1,
          messages: [
            {
              id: 'history',
              role: 'assistant',
              parts: [{ type: 'text', text: 'EXISTING_HISTORY_' + target.agentId }],
            },
          ],
          model: 'qa',
          thinkingLevel: 'low',
        }),
        copyOutput: async (request) => {
          window.__qa.copied = contents[request.path];
        },
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

  const file = (name) =>
    js(
      `Array.from(document.querySelectorAll('.file-tree-file-row .file-tree-item')).find(button=>button.textContent.includes(${JSON.stringify(name)})).click()`,
    );
  const agent = (name) =>
    js(
      `Array.from(document.querySelectorAll('.project-agent-menu .section-menu-item')).find(button=>button.textContent.includes(${JSON.stringify(name)})).click()`,
    );
  const shortcut = async () => {
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'а',
      code: 'KeyF',
      modifiers: 4,
      windowsVirtualKeyCode: 70,
    });
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'а',
      code: 'KeyF',
      modifiers: 4,
      windowsVirtualKeyCode: 70,
    });
  };
  for (const language of ['ru', 'en'])
    for (const theme of ['light', 'dark']) {
      await visit(language, theme);
      await js(
        `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('Project a')).click()`,
      );
      await until(`!!document.querySelector('.file-tree-file-row')`);
      await file('pipeline.py');
      await until(`!!document.querySelector('.monaco-editor .view-lines')`);
      await until(`document.querySelector('.view-lines').textContent.includes('run_pipeline')`);
      assert.equal(
        await js(`document.querySelector('.monaco-editor textarea').getAttribute('readonly')`),
        'true',
      );
      assert.equal(
        await js(`document.querySelector('.monaco-editor').classList.contains('vs-dark')`),
        theme === 'dark',
      );
      await until(
        `new Set(Array.from(document.querySelectorAll('.view-line span')).map(e=>getComputedStyle(e).color)).size>=3`,
      );
      const colors = await js(
        `Array.from(document.querySelectorAll('.view-line span')).map(e=>getComputedStyle(e).color)`,
      );
      assert.ok(new Set(colors).size >= 3, 'Actual Python syntax colors');
      await shortcut();
      await until(`!!document.querySelector('.find-widget.visible')`);
      await cdp('Input.insertText', { text: 'pipeline' });
      await until(`document.querySelector('.matchesCount').textContent.includes('2')`);
      await until(
        `document.querySelector('.find-widget').getBoundingClientRect().top>=document.querySelector('.monaco-editor').getBoundingClientRect().top`,
      );
      await until(`document.fonts.check('16px codicon')`);
      await click('.copy-output-button');
      assert.equal(
        await js('window.__qa.copied'),
        'import os\n# PIPELINE_SOURCE\ndef run_pipeline():\n    return 42\n'.replaceAll(
          '\\n',
          '\n',
        ),
      );
      await cdp('Page.captureScreenshot', { format: 'png' }).then((shot) =>
        writeFile(`artifacts/monaco-${language}-${theme}.png`, Buffer.from(shot.data, 'base64')),
      );
      await file('layout.css');
      await until(`document.querySelector('.view-lines')?.textContent.includes('translateX')`);
      await until(
        `new Set(Array.from(document.querySelectorAll('.view-line span')).map(e=>getComputedStyle(e).color)).size>=3`,
      );
      assert.ok(
        new Set(
          await js(
            `Array.from(document.querySelectorAll('.view-line span')).map(e=>getComputedStyle(e).color)`,
          ),
        ).size >= 3,
        'CSS syntax colors',
      );
      await file('app.js');
      await until(`document.querySelector('.view-lines')?.textContent.includes('export')`);
      await until(
        `new Set(Array.from(document.querySelectorAll('.view-line span')).map(e=>getComputedStyle(e).color)).size>=3`,
      );
      await file('data.json');
      await until(`document.querySelector('.view-lines')?.textContent.includes('pipeline')`);
      await shortcut();
      await until(`!!document.querySelector('.find-widget.visible')`);
      for (const name of ['portrait.mp4', 'landscape.mp4']) {
        await file(name);
        await until(`document.querySelector('.mp4-preview video')?.videoWidth>0`);
        await js(
          `window.__qa.video = document.querySelector('.mp4-preview video');window.__qa.video.currentTime=1.5`,
        );
        await until(
          `window.__qa.video.currentTime>=1.4&&!window.__qa.video.seeking&&window.__qa.video.readyState>=2`,
        );
        await until(
          `Math.abs(document.querySelector('.mp4-preview video').getBoundingClientRect().width/document.querySelector('.mp4-preview video').getBoundingClientRect().height-document.querySelector('.mp4-preview video').videoWidth/document.querySelector('.mp4-preview video').videoHeight)<0.01`,
        );
        const fit = await js(
          `(()=>{const v=window.__qa.video,stage=document.querySelector('.mp4-preview-stage');const a=v.getBoundingClientRect(),b=stage.getBoundingClientRect();return {width:a.width,height:a.height,nw:v.videoWidth,nh:v.videoHeight,fits:a.width<=b.width+1&&a.height+24<=b.height+1}})()`,
        );
        assert.equal(fit.fits, true);
        assert.ok(
          Math.abs(fit.width / fit.height - fit.nw / fit.nh) < 0.01,
          'Aspect ratio preserved',
        );
        const resize = await js(
          `(()=>{const r=document.querySelector('.mp4-preview-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
        );
        await cdp('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          ...resize,
        });
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          button: 'left',
          buttons: 1,
          x: resize.x - 100,
          y: resize.y - 100,
        });
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          x: resize.x - 100,
          y: resize.y - 100,
        });
        await until(`window.__qa.video.getBoundingClientRect().width<${fit.width - 40}`);
        assert.equal(
          await js(
            `window.__qa.video===document.querySelector('.mp4-preview video')&&window.__qa.video.currentTime>=1.4`,
          ),
          true,
        );
        await click('.mp4-preview-toolbar button');
        await until(`Math.abs(window.__qa.video.getBoundingClientRect().width-${fit.width})<2`);
        await cdp('Emulation.setDeviceMetricsOverride', {
          width: 900,
          height: 640,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await until(
          `(()=>{const v=window.__qa.video.getBoundingClientRect(),s=document.querySelector('.mp4-preview-stage').getBoundingClientRect();return v.height+24<=s.height+1&&v.width<=s.width+1})()`,
        );
        await cdp('Page.captureScreenshot', { format: 'png' }).then((shot) =>
          writeFile(
            `artifacts/mp4-${name}-${language}-${theme}.png`,
            Buffer.from(shot.data, 'base64'),
          ),
        );
        await cdp('Emulation.setDeviceMetricsOverride', {
          width: 1100,
          height: 840,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }
      // Agent click reuses a live process, never invokes launch or sends a task.
      await agent('Agent a');
      await until(
        `document.querySelector('.pi-chat-panel')?.textContent.includes('EXISTING_HISTORY_a')`,
      );
      await file('other.txt');
      await until(`!document.querySelector('.pi-chat-panel')`);
      await agent('Agent a');
      await until(`!!document.querySelector('.pi-chat-panel')`);
      await agent('Agent b');
      await until(`!document.querySelector('.pi-chat-panel')`);
      await js(`window.__qa.delay=400`);
      await agent('Agent a');
      await file('other.txt');
      await new Promise((done) => setTimeout(done, 500));
      assert.equal(
        await js(`!!document.querySelector('.pi-chat-panel')`),
        false,
        'Delayed process read cannot override explicit file selection',
      );
      await agent('Agent a');
      await agent('Agent b');
      await new Promise((done) => setTimeout(done, 500));
      assert.equal(
        await js(`!!document.querySelector('.pi-chat-panel')`),
        false,
        'Rapid agent switches ignore stale process reads',
      );
      assert.deepEqual(await js('window.__qa.calls'), { launch: 0, commands: 0, saves: 0 });
      await js(
        `window.__qa.update={phase:'available',currentVersion:'QA',offer:{version:'QA-next',bytes:1000,notes:'QA',releaseUrl:'https://github.com/vtlk/pi-studio/releases'}}`,
      );
      await until(`!!document.querySelector('.update-available-dot')`);
      assert.equal(
        await js(
          `getComputedStyle(document.querySelector('.update-available-dot')).backgroundColor`,
        ),
        'rgb(239, 68, 68)',
      );
      const geometry = () =>
        js(`(() => {
        const update = document.querySelector('.update-action');
        const theme = document.querySelector('.theme-toggle');
        const a = update.getBoundingClientRect(), b = theme.getBoundingClientRect();
        const icon = update.querySelector('svg').getBoundingClientRect();
        return {update:[a.width,a.height],theme:[b.width,b.height],icon:[icon.width,icon.height]};
      })()`);
      assert.deepEqual(await geometry(), { update: [38, 38], theme: [38, 38], icon: [19, 19] });
      const hover = async (selector) => {
        const point = await js(
          `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
        );
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        return js(
          `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`,
        );
      };
      assert.equal(await hover('.update-action'), await hover('.theme-toggle'));
      await js(`window.__qa.update={...window.__qa.update,phase:'downloading',downloaded:500}`);
      await until(`!!document.querySelector('.update-download-progress')`);
      assert.deepEqual(await geometry(), { update: [38, 38], theme: [38, 38], icon: [19, 19] });
      await js(`window.__qa.update={phase:'idle',currentVersion:'QA-next'}`);
      await until(`!document.querySelector('.update-available-dot')`);
      checks.push({
        language,
        theme,
        pythonCssJsJsonSyntax: true,
        readOnly: true,
        findPhysicalRussianShortcut: true,
        copyUnchanged: true,
        mp4FitResizeAndPlaybackPreserved: true,
        chatLiveOnlyAndRaceSafe: true,
        updateDotTracksOffer: true,
        updateButtonMatchesTopbarDuringOfferAndDownload: true,
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
  await writeFile('artifacts/rich-preview-chat-proof.json', JSON.stringify(proof, null, 2) + '\n');
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
