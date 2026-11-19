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
const root = await mkdtemp(join(tmpdir(), 'pistudio-input-refinements-'));
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
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
      }[extname(path)] || 'application/octet-stream',
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
const contexts = new Map();
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
    if (
      message.method === 'Runtime.executionContextCreated' &&
      message.params.context.auxData?.isDefault
    )
      contexts.set(message.params.context.auxData.frameId, message.params.context.id);
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
    if (window.top !== window) return;
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
    contents[prefix + name] =
      `<h1 id="motion">STATIC</h1><button id="local-action" onclick="document.getElementById('motion').textContent='HANDLER_OK'">Run local action</button><script>document.getElementById('motion').textContent='SCRIPT_OK';try{parent.document.body.dataset.escaped='BAD'}catch{window.parentBlocked=true}fetch('${probe}').catch(()=>window.networkBlocked=true);window.popupBlocked=window.open('${probe}')===null;</script><script src="local.js"></script>`;
    contents[prefix + 'local.js'] = "document.body.dataset.localScript='LOCAL_JS_OK'";
    contents[prefix + 'pipeline.py'] += '# ' + 'long source comment '.repeat(80);
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
      makeFile(prefix + 'local.js'),
      makeFile(prefix + 'logo.svg'),
      makeFile(prefix + 'other.txt'),
      {
        kind: 'folder',
        id: prefix + 'nested',
        name: 'nested',
        children: [makeFile(prefix + 'nested/data.txt')],
      },
    ];
    projects[0].agents[1].entries = [
      {
        id: 'only-folder',
        name: 'only-folder',
        kind: 'folder',
        children: [
          {
            id: 'nested-only.txt',
            name: 'nested-only.txt',
            kind: 'file',
            format: 'text',
            content: 'NESTED_ONLY',
          },
        ],
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

    const RealWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('voice.worker-')) return new RealWorker(url, options);
        this.postMessage = (data) => {
          setTimeout(
            () =>
              this.onmessage?.({
                data: {
                  id: data.id,
                  ...(data.command === 'load' ? { ready: true } : { text: 'VOICE_TEXT' }),
                },
              }),
            data.command === 'load' ? 600 : 1000,
          );
        };
        this.terminate = () => {};
      }
    };
    const wav = new ArrayBuffer(44 + 3200 * 2),
      view = new DataView(wav);
    const chars = (offset, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    chars(0, 'RIFF');
    view.setUint32(4, wav.byteLength - 8, true);
    chars(8, 'WAVE');
    chars(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    chars(36, 'data');
    view.setUint32(40, 6400, true);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          window.__qa.micCalls = (window.__qa.micCalls || 0) + 1;
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    });
    window.MediaRecorder = class {
      constructor(stream) {
        this.stream = stream;
        this.mimeType = 'audio/wav';
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([wav], { type: 'audio/wav' }) });
        void this.onstop?.();
      }
    };
    const staged = new Map();
    const draftStorageKey = 'qa-drafts-' + language + '-' + theme;
    const readDrafts = () => JSON.parse(sessionStorage.getItem(draftStorageKey) || '{}');
    const draftKey = (request) =>
      JSON.stringify([request.folder, request.projectId, request.agentId]);
    const writeDrafts = (value) => sessionStorage.setItem(draftStorageKey, JSON.stringify(value));
    window.studio = new Proxy(
      {
        loadChatDrafts: async ({ folder }) => {
          const drafts = Object.entries(readDrafts())
            .filter(([key]) => JSON.parse(key)[0] === folder)
            .map(([, draft]) => {
              for (const file of draft.attachments) staged.set(file.id, file);
              return draft;
            });
          return { folder, drafts };
        },
        saveChatDraft: async (request) => {
          await new Promise((done) => setTimeout(done, 800));
          const drafts = readDrafts();
          drafts[draftKey(request)] = {
            ...request,
            attachments: request.attachments.map((id) => staged.get(id)),
          };
          writeDrafts(drafts);
          return { revision: request.revision };
        },
        getVoiceModelState: async () => ({ phase: 'ready', downloaded: 100, total: 100 }),
        prepareVoiceModel: async () => {
          window.__qa.voicePrepare = (window.__qa.voicePrepare || 0) + 1;
        },
        cancelVoiceModel: async () => {},
        requestVoiceMicrophone: async () => true,
        stageDroppedFiles: async (files) =>
          Promise.all(
            files.map(async (file) => {
              const id = crypto.randomUUID();
              const item = {
                id,
                name: file.name,
                text: await file.text(),
                size: file.size,
                type: file.type,
              };
              staged.set(id, item);
              return item;
            }),
          ),
        stageClipboardImage: async (request) => {
          window.__qa.pastedBytes = request.bytes.byteLength;
          const id = crypto.randomUUID();
          const item = {
            id,
            name: 'clipboard.png',
            text: '',
            size: request.bytes.byteLength,
            type: 'image/png',
          };
          staged.set(id, item);
          return item;
        },
        releaseReferenceFiles: async (ids) => {
          for (const id of ids) staged.delete(id);
        },
        importAgentFiles: async (request) => {
          window.__qa.imported = request;
          const paths = [];
          for (const id of request.ids) {
            const item = staged.get(id);
            const path = prefix + item.name;
            contents[path] = item.text;
            projects[0].agents[0].entries.push(makeFile(path));
            paths.push(path);
          }
          return paths;
        },
        sendChat: async (request) => {
          window.__qa.sends = (window.__qa.sends || 0) + 1;
          window.__qa.sent = request;
          const drafts = readDrafts();
          const key = draftKey({ ...request, folder: request.draft.folder });
          const revision = request.draft.revision + 1;
          drafts[key] = { ...drafts[key], text: '', attachments: [], revision };
          writeDrafts(drafts);
          return { draft: { cleared: true, revision } };
        },
        getInfo: async () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
        getLanguage: async () => ({ language, preference: language, revision: 0 }),
        getTheme: async () => ({ theme, preference: theme, revision: 0 }),
        setTheme: async (value) => ({ theme: (theme = value), preference: value, revision: 1 }),
        getUpdateState: async () => window.__qa.update ?? { phase: 'idle', currentVersion: 'QA' },
        reportUpdateReadiness: async (report) => {
          window.__qa.readiness = report;
        },
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
          working: window.__qa.working ?? true,
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
  const frameJs = async (expression) => {
    const tree = await cdp('Page.getFrameTree');
    const child = tree.frameTree.childFrames.find((frame) => frame.frame.url === 'about:srcdoc');
    const contextId = contexts.get(child.frame.id);
    assert.ok(contextId, 'Real document main execution context');
    const value = await cdp('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (value.exceptionDetails)
      throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  for (const language of ['ru', 'en'])
    for (const theme of ['light', 'dark']) {
      const messages = language === 'ru' ? ru : en;
      await visit(language, theme);
      await js(
        `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('Project a')).click()`,
      );
      await until(`!!document.querySelector('.file-tree-file-row')`);
      assert.equal(
        await js(`document.querySelector('.file-tree-folder').getAttribute('aria-expanded')`),
        'false',
      );
      assert.ok(
        await js(
          `document.querySelector('.file-tree-file-row[data-selected]')?.textContent.includes(window.__qa.name)`,
        ),
        'Root file initially selected',
      );
      await file('pipeline.py');
      await until(
        `!!document.querySelector('.monaco-editor')&&!!document.querySelector('.preview-wrap-button')`,
      );
      await until(`document.querySelector('.view-lines').textContent.includes('comment')`);
      await js(`window.__qa.editor=document.querySelector('.monaco-editor')`);
      assert.equal(
        await js(`document.querySelector('.preview-wrap-button').getAttribute('aria-pressed')`),
        'true',
      );
      await click('.preview-wrap-button');
      await until(
        `document.querySelector('.preview-wrap-button').getAttribute('aria-pressed')==='false'`,
      );
      assert.equal(await js(`window.__qa.editor===document.querySelector('.monaco-editor')`), true);
      await click('.preview-wrap-button');
      await file('other.txt');
      await until(`!document.querySelector('.preview-wrap-button')`);
      const point = await js(
        `(()=>{const row=Array.from(document.querySelectorAll('.file-tree-file-row')).find(row=>row.textContent.includes('other.txt'));window.__qa.hover=row;const r=row.getBoundingClientRect();return{x:r.x+8,y:r.y+8};})()`,
      );
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      assert.equal(
        await js(
          `(()=>{const row=window.__qa.hover,b=row.querySelector('.file-tree-reveal'),a=row.getBoundingClientRect(),r=b.getBoundingClientRect();return getComputedStyle(row).backgroundColor!=='rgba(0, 0, 0, 0)'&&r.left>=a.left&&r.right<=a.right&&getComputedStyle(b).opacity==='1'})()`,
        ),
        true,
        'Locate lies inside the full hover row',
      );
      await file(await js('window.__qa.name'));
      await until(`!!document.querySelector('.html-preview-frame')`);
      assert.equal(await frameJs(`document.getElementById('motion').textContent`), 'STATIC');
      assert.equal(await js(`!!document.querySelector('.preview-wrap-button')`), false);
      await js(
        `Array.from(document.querySelectorAll('.html-preview-toolbar button')).find(button=>button.textContent===${JSON.stringify(messages['HtmlPreview.enableScripts'])}).click()`,
      );
      await until(
        `document.querySelector('.html-preview-frame')?.getAttribute('sandbox')==='allow-scripts'`,
      );
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(await frameJs(`document.getElementById('motion').textContent`), 'SCRIPT_OK');
      assert.equal(await frameJs(`document.body.dataset.localScript`), 'LOCAL_JS_OK');
      assert.equal(
        await frameJs(
          `window.parentBlocked===true && window.networkBlocked===true && window.popupBlocked===true && typeof window.studio==='undefined' && typeof RTCPeerConnection==='undefined'`,
        ),
        true,
      );
      await frameJs(`document.getElementById('local-action').click()`);
      assert.equal(await frameJs(`document.getElementById('motion').textContent`), 'HANDLER_OK');
      await js(
        `Array.from(document.querySelectorAll('.html-preview-toolbar button')).find(button=>button.textContent===${JSON.stringify(messages['HtmlPreview.source'])}).click()`,
      );
      await until(`!!document.querySelector('.preview-wrap-button')`);
      await agent('Agent b');
      await until(`!document.querySelector('.pi-chat-panel')`);
      assert.equal(
        await js(`document.querySelector('.file-tree-folder').getAttribute('aria-expanded')`),
        'false',
      );
      assert.equal(
        await js(`!!document.querySelector('.file-tree-file-row[data-selected]')`),
        false,
      );
      await agent('Agent a');
      await until(`!!document.querySelector('.pi-chat-panel')`);
      await js(
        `(()=>{const data=new DataTransfer();data.items.add(new File(['AGENT_IMPORT'],'drop-agent.txt',{type:'text/plain'}));const pane=document.querySelector('.output-files-pane');pane.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:data}));})()`,
      );
      assert.equal(
        await js(`!!document.querySelector('.output-files-pane .file-drop-overlay')`),
        true,
      );
      await js(
        `(()=>{const data=new DataTransfer();data.items.add(new File(['AGENT_IMPORT'],'drop-agent.txt',{type:'text/plain'}));document.querySelector('.output-files-pane').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`,
      );
      await until(
        `Array.from(document.querySelectorAll('.file-tree-file-row')).some(row=>row.textContent.includes('drop-agent.txt'))`,
      );
      assert.equal(
        await js(
          `window.__qa.imported.projectId==='project-a'&&window.__qa.imported.agentId==='a'`,
        ),
        true,
      );
      await js(
        `(()=>{const data=new DataTransfer();data.items.add(new File(['CHAT_ATTACHMENT'],'chat-file.txt',{type:'text/plain'}));document.querySelector('.pi-chat-panel').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`,
      );
      await until(
        `document.querySelector('.reference-attachment-list')?.textContent.includes('chat-file.txt')`,
      );
      await js(`document.querySelector('.pi-chat-composer textarea').focus()`);
      await cdp('Input.insertText', { text: 'Draft' });
      await js(
        `(()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'image.png',{type:'image/png'}));document.querySelector('.pi-chat-composer textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`,
      );
      await until(
        `document.querySelector('.reference-attachment-list')?.textContent.includes('clipboard.png')`,
      );
      assert.equal(await js(`document.querySelector('.pi-chat-composer textarea').value`), 'Draft');
      assert.equal(await js(`window.__qa.pastedBytes`), 8);
      assert.equal(await js(`window.__qa.sends||0`), 0);
      await until(`window.__qa.readiness?.blocker==='draft-saving'`);
      await until(`window.__qa.readiness?.saved===true&&!window.__qa.readiness?.blocker`);
      assert.equal(await js(`document.querySelector('.pi-chat-composer textarea').value`), 'Draft');
      await until(
        `!document.querySelector('.pi-chat-panel').getAnimations().some(animation=>animation.playState==='running')`,
      );
      const actionXs = () =>
        js(
          `['.reference-attachments-compact button','.voice-input button','.pi-chat-composer-actions>button:last-child'].map(s=>document.querySelector(s).getBoundingClientRect().x)`,
        );
      const idleActionXs = await actionXs();
      const mic = await js(
        `(()=>{const b=Array.from(document.querySelectorAll('.voice-input button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(messages['Voice.start'])});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      await cdp('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...mic,
      });
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...mic,
      });
      await until(
        `document.querySelector('.pi-chat-voice-status')?.textContent.includes(${JSON.stringify(messages['Voice.loading'])})`,
      );
      await until(`document.querySelector('.voice-input').dataset.voicePhase==='recording'`);
      assert.deepEqual(await actionXs(), idleActionXs, 'Voice status never shifts action buttons');
      assert.equal(
        await js(
          `(()=>{const s=document.querySelector('.pi-chat-voice-status').getBoundingClientRect(),a=document.querySelector('.reference-attachments-compact button').getBoundingClientRect();return s.right<=a.left;})()`,
        ),
        true,
      );
      await until(`window.__qa.readiness?.blocker==='voice'`);
      await click('.voice-input button');
      await until(`document.querySelector('.voice-input').dataset.voicePhase==='transcribing'`);
      await file('other.txt');
      await until(`!document.querySelector('.pi-chat-panel')`);
      assert.equal(await js(`!!document.querySelector('[data-unsaved-draft="true"]')`), true);
      await new Promise((done) => setTimeout(done, 1500));
      await agent('Agent a');
      await until(`!!document.querySelector('.pi-chat-panel')`);
      await until(
        `document.querySelector('.pi-chat-composer textarea').value==='Draft VOICE_TEXT'`,
      );
      await until(`document.querySelector('.voice-input').dataset.voicePhase==='idle'`);
      assert.equal(await js(`window.__qa.sends||0`), 0, 'Voice and attachments never auto-send');
      await until(
        `!document.querySelector('.pi-chat-panel').getAnimations().some(a=>a.playState==='running')`,
      );
      await until(`window.__qa.readiness?.saved===true&&!window.__qa.readiness?.blocker`);
      const reopen = async (studio = 'A') => {
        await until(`!document.querySelector('[data-chat-draft-pending="true"]')`);
        await visit(language, theme, studio);
        await js(
          `Array.from(document.querySelectorAll('.project-list-row')).find(row=>row.textContent.includes('Project a')).click()`,
        );
        await until(`!!document.querySelector('.project-agent-menu')`);
        await agent('Agent a');
        await until(
          `!!document.querySelector('.pi-chat-composer textarea')&&!document.querySelector('.pi-chat-composer textarea').disabled`,
        );
      };
      await reopen();
      assert.equal(
        await js(`document.querySelector('.pi-chat-composer textarea').value`),
        'Draft VOICE_TEXT',
      );
      assert.equal(
        await js(
          `document.querySelectorAll('.reference-attachment-list li').length || document.querySelectorAll('.reference-attachment-list .reference-attachment').length`,
        ),
        2,
      );
      assert.equal(await js(`window.__qa.sends||0`), 0);
      await until(`window.__qa.readiness?.saved===true&&!window.__qa.readiness?.blocker`);
      await reopen('B');
      assert.equal(await js(`document.querySelector('.pi-chat-composer textarea').value`), '');
      await js(`document.querySelector('.pi-chat-composer textarea').focus()`);
      await cdp('Input.insertText', { text: 'OTHER_STUDIO' });
      await until(`window.__qa.readiness?.saved===true&&!window.__qa.readiness?.blocker`);
      await reopen();
      assert.equal(
        await js(`document.querySelector('.pi-chat-composer textarea').value`),
        'Draft VOICE_TEXT',
      );
      assert.equal(
        await js(
          `(()=>{const a=document.querySelector('.pi-chat-attachments').getBoundingClientRect(),t=document.querySelector('.pi-chat-composer .ui-textarea-control').getBoundingClientRect();return a.bottom<=t.top;})()`,
        ),
        true,
      );
      const checkActions = async () => {
        const r = await js(
          `(()=>{const pane=document.querySelector('.pi-chat-composer'), attach=pane.querySelector('.reference-attachments-compact button'),mic=pane.querySelector('.voice-input button'),send=pane.querySelector('.pi-chat-composer-actions>button:last-child');return [attach,mic,send,pane].map(el=>el.getBoundingClientRect().toJSON());})()`,
        );
        assert.ok(
          Math.abs(r[0].y - r[1].y) < 1 && Math.abs(r[1].y - r[2].y) < 1,
          'Chat actions share one row',
        );
        assert.ok(
          Math.abs(r[1].left - r[0].right - 8) < 1 && Math.abs(r[2].left - r[1].right - 8) < 1,
          'Attach, microphone, send are consecutive',
        );
        assert.ok(
          r[3].right - r[2].right >= 8 && r[3].right - r[2].right <= 16,
          'Actions are at the right edge',
        );
      };
      await until(
        `!document.querySelector('.pi-chat-panel').getAnimations().some(a=>a.playState==='running')`,
      );
      await checkActions();
      assert.equal(
        await js(
          `(()=>{const r=document.querySelector('.pi-chat-panel').getBoundingClientRect();return r.right<=innerWidth&&r.left>=0;})()`,
        ),
        true,
      );

      await cdp('Page.captureScreenshot', { format: 'png' }).then((shot) =>
        writeFile(
          `artifacts/chat-inputs-${language}-${theme}.png`,
          Buffer.from(shot.data, 'base64'),
        ),
      );
      await js(
        `Array.from(document.querySelectorAll('.pi-chat-composer button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(messages['Chat.enqueue'])}).click()`,
      );
      await until(
        `document.querySelector('.pi-chat-composer textarea').value===''&&!document.querySelector('.reference-attachment-list')`,
      );
      assert.equal(await js(`window.__qa.sends`), 1, 'Only the explicit QA send dispatches');
      await until(`window.__qa.readiness?.saved===true&&!window.__qa.readiness?.blocker`);
      await js(`window.__qa.working=false`);
      await until(
        `Array.from(document.querySelectorAll('.pi-chat-composer-actions>button')).some(b=>b.getAttribute('aria-label')===${JSON.stringify(messages['Chat.send'])})`,
      );
      await checkActions();
      assert.deepEqual(await js('window.__qa.calls'), { launch: 0, commands: 0, saves: 0 });
      await reopen();
      assert.equal(await js(`document.querySelector('.pi-chat-composer textarea').value`), '');
      assert.equal(await js(`window.__qa.sends||0`), 0);
      checks.push({
        language,
        theme,
        rootFileOnly: true,
        locateInsideHover: true,
        wordWrapWithoutEditorRemount: true,
        optInLocalJavaScript: true,
        opaqueNoIPCOrNetwork: true,
        dropToChatAndAgent: true,
        pasteImageKeepsDraft: true,
        attachmentsAboveTextarea: true,
        voiceStatusLeftOfStableActions: true,
        microphoneUiDecodeAndInsertion: true,
        hiddenChatVoicePreserved: true,
        noAutomaticSend: true,
        rightAlignedConsecutiveChatActions: true,
        pendingDraftSaveAndVoiceUpdateBlockers: true,
        savedDraftRestoresWithoutBlockingUpdates: true,
        restoredAttachments: 2,
        studioDraftIsolation: true,
        sentDraftDoesNotResurrect: true,
        cachedModelShowsLocalLoading: true,
      });
    }
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    checks,
    actualProbeRequests: probes,
    realVoiceInference: false,
    microphoneAndWorker: 'Controlled recording/worker; actual pinned Whisper tested separately',
    nativeExplorerOrFinderOpened: false,
    userAppOrDataChanged: false,
    scope:
      'Actual compiled renderer + isolated headless shell; controlled native APIs and media transport. Not native Windows acceptance.',
  };
  await writeFile('artifacts/input-refinements-proof.json', JSON.stringify(proof, null, 2) + '\n');
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
