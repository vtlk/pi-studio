import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';

// Uses only the installed, isolated headless shell. Never launches the system browser or Electron.
const executable =
  process.env.PISTUDIO_QA_CHROME ||
  join(
    homedir(),
    'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  );
const root = await mkdtemp(join(tmpdir(), 'pistudio-onboarding-'));
const webRoot = resolve('out/renderer');
const server = createServer(async (request, response) => {
  try {
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
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 840,
    deviceScaleFactor: 1,
    mobile: false,
  });
  function fixture() {
    const agent = {
      id: 'qa-agent',
      name: 'QA agent',
      enabled: true,
      instructions: [],
      skills: [],
      mcps: ['qa-mcp'],
      plugins: [],
    };
    const assistant = {
      ...agent,
      id: 'qa-assistant',
      name: 'QA assistant',
      mcps: [],
      systemRole: 'assistant',
    };
    const team = { id: 'qa-team', name: 'Imported team', agentIds: [agent.id] };
    const mcp = {
      id: 'qa-mcp',
      name: 'QA MCP',
      kind: 'mcps',
      source: 'pi:qa',
      version: '',
      description: '',
      transport: 'http',
      args: '',
      credential: '',
      contents: '',
      createdAt: 1,
      check: { status: 'needs_auth', checkedAt: 1 },
    };
    const state = {
      folder: '/isolated-onboarding-fixture',
      sections: {
        connections: [],
        agentCatalog: { teams: [team], agents: [agent] },
        systemAgents: [assistant],
        resources: [mcp],
        piPath: '',
        baseInstruction: '',
      },
      projects: [],
      trashProjects: [],
      warnings: [],
    };
    const report = {
      id: 'qa-import',
      teamId: team.id,
      teamName: team.name,
      createdAt: 1,
      handoff: 'pending',
      agents: [],
      requirements: [],
      mcps: [
        { resourceId: mcp.id, authorization: { required: 'yes', methods: ['oauth'], fields: [] } },
      ],
    };
    const calls = { assistant: 0, otherLaunches: 0, imports: 0 };
    const reports = [report];
    const clone = (value) => structuredClone(value);
    let finish,
      theme = 'light';
    window.__qa = {
      state,
      calls,
      configureModels() {
        state.sections.connections = [
          {
            id: 'qa-connection',
            name: 'Receiver',
            purpose: 'pi',
            providerId: 'qa',
            endpoint: '',
            account: '',
            createdAt: 1,
          },
        ];
        const model = {
          connectionId: 'qa-connection',
          provider: 'qa',
          id: 'receiver-model',
          reasoning: 'off',
          temperature: '',
        };
        state.sections.agentCatalog.agents[0].model = { ...model };
        state.sections.systemAgents[0].model = { ...model };
      },
      finishAssistant() {
        finish?.({
          report: { ...report, handoff: 'sent' },
          assistantId: assistant.id,
          outcome: 'opened',
        });
      },
    };
    window.studio = new Proxy(
      {
        getLanguage: async () => ({ language: 'ru', preference: 'ru', revision: 0 }),
        setLanguage: async (language) => ({ language, preference: language, revision: 1 }),
        getTheme: async () => ({ theme, preference: theme, revision: 0 }),
        setTheme: async (next) => ({ theme: (theme = next), preference: next, revision: 1 }),
        getInfo: async () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
        getUpdateState: async () => ({ phase: 'idle', currentVersion: 'QA' }),
        getStartup: async () => ({ phase: 'skipped', message: 'QA' }),
        getGitHubStar: async () => ({
          due: false,
          disabled: false,
          revision: 0,
          canPresent: false,
        }),
        loadStudio: async () => clone(state),
        saveSection: async (key, value) => {
          state.sections[key] = clone(value);
          return { saved: true, value };
        },
        listTeamImports: async () => clone(reports),
        importAgentTeam: async () => {
          calls.imports++;
          const importedAgent = {
            ...agent,
            id: 'qa-imported-agent',
            name: 'New imported agent',
            mcps: ['qa-imported-mcp'],
            model: { ...agent.model, connectionId: '' },
          };
          const importedTeam = {
            ...team,
            id: 'qa-imported-team',
            name: 'New imported team',
            agentIds: [importedAgent.id],
          };
          const importedMcp = {
            ...mcp,
            id: 'qa-imported-mcp',
            name: 'New imported MCP',
            check: undefined,
          };
          state.sections.agentCatalog = {
            agents: [...state.sections.agentCatalog.agents, importedAgent],
            teams: [...state.sections.agentCatalog.teams, importedTeam],
          };
          state.sections.resources = [...state.sections.resources, importedMcp];
          const importedReport = {
            ...report,
            id: 'qa-second-import',
            teamId: importedTeam.id,
            teamName: importedTeam.name,
            mcps: [{ ...report.mcps[0], resourceId: importedMcp.id }],
          };
          reports.push(importedReport);
          return { report: clone(importedReport), assistantId: assistant.id, outcome: 'pending' };
        },
        listProjectUsage: async () => [],
        listProjectActivity: async () => [],
        getModelCatalog: async () => ({
          providers: [{ id: 'qa', name: 'QA', configured: true, subscription: false }],
          models: [
            {
              id: 'receiver-model',
              name: 'Receiver model',
              provider: 'qa',
              reasoning: false,
              imageInput: false,
            },
          ],
        }),
        getConnectionStatus: async ({ connectionId }) => ({
          connectionId,
          provider: 'qa',
          status: 'ready',
        }),
        continueTeamImport: async (request) => {
          if (request.folder !== state.folder || request.id !== report.id)
            throw Error('Wrong team scope');
          calls.assistant++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        launchAgent: async () => {
          calls.otherLaunches++;
          throw Error('Forbidden production launch');
        },
        openSetupAssistant: async () => {
          calls.otherLaunches++;
          throw Error('Unscoped assistant launch');
        },
      },
      {
        get(target, key) {
          if (String(key).startsWith('on')) return () => () => {};
          if (key in target) return target[key];
          return async () => {
            throw Error(`Unexpected QA API: ${String(key)}`);
          };
        },
      },
    );
  }
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})();` });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
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
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      if (await js(expression)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw Error(
      `UI condition failed: ${expression}\n${await js('document.body.innerText')}\n${errors.join('\n')}`,
    );
  };
  const open = () =>
    js(
      `Array.from(document.querySelectorAll('.topbar nav button')).find(b=>b.textContent.trim()==='Onboarding').click()`,
    );
  await until(
    `!!Array.from(document.querySelectorAll('.topbar nav button')).find(b=>b.textContent.trim()==='Onboarding')`,
  );
  await open();
  await until(`document.querySelectorAll('.onboarding-list li').length===4`);
  await js(
    `document.querySelector('.language-select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitemradio"][lang="en"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="en"]').click()`);
  await until(
    `document.querySelector('[data-task-id="connection"] .onboarding-task-label')?.textContent==='Set up a connection'`,
  );
  await js(
    `document.querySelector('.language-select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitemradio"][lang="ru"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="ru"]').click()`);
  await until(
    `document.querySelector('[data-task-id="connection"] .onboarding-task-label')?.textContent==='Настроить подключение'`,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.onboarding-list input,.onboarding-list [role="checkbox"]').length`,
    ),
    0,
  );
  await js(`document.querySelector('[data-task-id="connection"] button').click()`);
  await until(
    `!!document.querySelector('.connections-layout, .connections-panel') || document.querySelector('.settings-layout')?.textContent.includes('Подключения')`,
  );
  await open();
  await js('window.__qa.configureModels();window.dispatchEvent(new Event("focus"))');
  await until(`document.querySelectorAll('.onboarding-list li[data-complete="true"]').length===3`);
  const style = await js(
    `(()=>{const row=document.querySelector('.onboarding-list li[data-complete="true"]');const b=document.querySelector('.onboarding-content').getBoundingClientRect();return {color:getComputedStyle(row.querySelector('.onboarding-status')).backgroundColor,strike:getComputedStyle(row.querySelector('.onboarding-task-label')).textDecorationLine,center:b.x+b.width/2,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
  );
  assert.equal(style.color, 'rgb(255, 212, 71)');
  assert.ok(style.strike.includes('line-through'));
  assert.ok(Math.abs(style.center - style.viewport / 2) < 2);
  assert.equal(style.overflow, false);
  await mkdir('artifacts', { recursive: true });
  const screenshot = async (name) => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join('artifacts', name), Buffer.from(data, 'base64'));
  };
  await screenshot('onboarding-light.png');
  await js(
    `(()=>{const button=document.querySelector('.onboarding-assistant button');button.click();button.click()})()`,
  );
  await until(
    `document.querySelector('.onboarding-assistant button')?.getAttribute('aria-busy')==='true'`,
  );
  assert.equal(await js('window.__qa.calls.assistant'), 1);
  await js('window.__qa.finishAssistant()');
  await until(`!document.querySelector('.onboarding-assistant button')?.disabled`);
  await js(
    `window.__qa.state.sections.resources[0].check={status:'available',checkedAt:Date.now()};window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `!Array.from(document.querySelectorAll('.topbar nav button')).some(b=>b.textContent.trim()==='Onboarding')`,
  );
  assert.equal(await js(`!!document.querySelector('.onboarding-page')`), false);
  await js(
    `window.__qa.state.sections.resources[0].check={status:'needs_auth',checkedAt:Date.now()};window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `Array.from(document.querySelectorAll('.topbar nav button')).some(b=>b.textContent.trim()==='Onboarding')`,
  );
  await open();
  await until(`document.querySelectorAll('.onboarding-list li').length===4`);
  await js(
    `(()=>{const now=Date.now()+2*60*60*1000+60000;Date.now=()=>now;window.dispatchEvent(new Event('focus'))})()`,
  );
  await until(`document.querySelectorAll('.onboarding-list li').length===1`);
  assert.equal(await js(`document.querySelector('.onboarding-list li').dataset.complete`), 'false');
  await js(`document.querySelector('.theme-toggle').click()`);
  await until(`document.documentElement.dataset.theme==='dark'`);
  await screenshot('onboarding-dark.png');
  await js(
    `document.querySelector('.language-select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
  );
  await until(`!!document.querySelector('[role="menuitemradio"][lang="en"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="en"]').click()`);
  await until(
    `document.querySelector('.onboarding-task-label')?.textContent==='Set up MCP authorization: QA MCP'`,
  );
  await js(
    `document.querySelector('.language-select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
  );
  await until(`!!document.querySelector('[role="menuitemradio"][lang="ru"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="ru"]').click()`);
  await until(
    `document.querySelector('.onboarding-task-label')?.textContent==='Настроить авторизацию MCP: QA MCP'`,
  );
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth'), false);
  await js(
    `window.__qa.state.sections.resources[0].check={status:'available',checkedAt:Date.now()};window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `!Array.from(document.querySelectorAll('.topbar nav button')).some(b=>b.textContent.trim()==='Onboarding')`,
  );
  await js(`document.querySelector('.settings-button').click()`);
  await until(`!!document.querySelector('.settings-layout')`);
  await js(
    `Array.from(document.querySelectorAll('.settings-layout button')).find(b=>b.textContent.trim()==='Команды агентов').click()`,
  );
  await until(
    `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Импорт команды агентов')`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Импорт команды агентов').click()`,
  );
  await until(
    `!!document.querySelector('.onboarding-list [data-task-id="agent:qa-imported-agent"]')`,
  );
  await until(`!!document.querySelector('.onboarding-list [data-task-id="mcp:qa-imported-mcp"]')`);
  assert.equal(await js('window.__qa.calls.imports'), 1);
  assert.equal(
    await js('window.__qa.calls.assistant'),
    1,
    'Import itself must not launch the assistant',
  );
  assert.equal(await js('window.__qa.calls.otherLaunches'), 0);
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    missingConnectionAndModelsIncludingAssistant: true,
    completedCircleYellowAndTextStruck: true,
    centeredWithoutHorizontalOverflow: true,
    scopedAssistantDuplicateClicksBlocked: true,
    automaticHideAndReturn: true,
    importOpensOnboardingAfterProfileHydration: true,
    completedTasksExpireAfterTwoHours: true,
    unresolvedTasksRemain: true,
    themes: ['light', 'dark'],
    languages: ['ru', 'en'],
    languages: ['ru', 'en'],
    userAppOrDataChanged: false,
    realPiOrAuthOrBrowserConsentLaunches: 0,
    nativePlatformAcceptance: false,
  };
  await writeFile('artifacts/onboarding-ui-proof.json', JSON.stringify(proof, null, 2) + '\n');
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
