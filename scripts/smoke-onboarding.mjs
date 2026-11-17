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
    const fresh = new URL(location.href).searchParams.has('fresh');
    const startupError = new URL(location.href).searchParams.has('startup-error');
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
      folder: fresh ? '/isolated-onboarding-fresh' : '/isolated-onboarding-fixture',
      sections: {
        connections: [],
        agentCatalog: { teams: fresh ? [] : [team], agents: fresh ? [] : [agent] },
        systemAgents: [assistant],
        resources: fresh ? [] : [mcp],
        piPath: '',
        baseInstruction: '',
      },
      projects: fresh
        ? []
        : [{ id: 'qa-existing-project', name: 'Existing project', createdAt: 1, agents: [] }],
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
    const calls = {
      assistant: 0,
      otherLaunches: 0,
      imports: 0,
      permissions: 0,
      installs: 0,
      terminalDownloads: 0,
    };
    const reports = fresh ? [] : [report];
    const clone = (value) => structuredClone(value);
    let finish,
      rejectAssistant,
      finishVisible,
      rejectVisible,
      theme = 'light';
    window.__qa = {
      state,
      calls,
      authorized: false,
      terminal: 'ready',
      computer: {
        version: 'QA',
        phase: 'permissions_required',
        permissions: { accessibility: false, screenRecording: false },
      },
      browser: { headlessInstalled: false, headedInstalled: false, headedSupported: true },
      images: 'not_ready',
      visibleInstalls: 0,
      rejectVisible(message) { rejectVisible?.(Error(message)); },
      finishVisible() {
        this.browser.headedInstalled = true;
        finishVisible?.(clone(this.browser));
      },
      authorize() {
        this.authorized = true;
      },
      configureImages() {
        state.sections.imageTool = { connectionId: 'qa-images', modelId: 'qa-image' };
        state.sections.connections.push({
          id: 'qa-images',
          name: 'Images',
          purpose: 'images',
          providerId: 'openai',
          endpoint: '',
          account: '',
          createdAt: 1,
        });
        this.images = 'ready';
      },
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
        for (const agent of state.sections.agentCatalog.agents) agent.model = { ...model };
        state.sections.systemAgents[0].model = { ...model };
      },
      finishAssistant() {
        finish?.({
          report: { ...report, handoff: 'sent' },
          assistantId: assistant.id,
          outcome: 'opened',
        });
      },
      failAssistant() {
        rejectAssistant?.(Error('QA helper failure'));
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
        getStartup: async () => ({
          phase: startupError ? 'error' : 'ready',
          message: 'QA startup',
        }),
        getGitHubStar: async () => ({
          due: false,
          disabled: false,
          revision: 0,
          canPresent: false,
        }),
        getOnboardingReadiness: async ({ folder }) => {
          if (folder !== state.folder) throw Error('Wrong readiness scope');
          return clone({
            folder,
            terminal: window.__qa.terminal,
            connections: Object.fromEntries(
              state.sections.connections
                .filter((c) => c.purpose !== 'images')
                .map((c) => [c.id, window.__qa.authorized ? 'ready' : 'not_ready']),
            ),
            mcps: Object.fromEntries(
              state.sections.resources.map((r) => [r.id, r.check?.status || 'missing']),
            ),
            computer: reports.some((r) => r.mcps.some((m) => m.resourceId === 'pistudio-computer'))
              ? window.__qa.computer
              : undefined,
            browser: reports.some((r) => r.mcps.some((m) => m.resourceId === 'pistudio-browser'))
              ? window.__qa.browser
              : undefined,
            images: reports.some((r) => r.requiresImages) ? window.__qa.images : undefined,
          });
        },
        getComputerState: async () => clone(window.__qa.computer),
        requestComputerPermissions: async () => {
          calls.permissions++;
          window.__qa.computer = {
            version: 'QA',
            phase: 'ready',
            permissions: { accessibility: true, screenRecording: true },
          };
          return clone(window.__qa.computer);
        },
        getBrowserState: async () => clone(window.__qa.browser),
        installVisibleBrowser: async () => {
          window.__qa.visibleInstalls++;
          return new Promise((resolve, reject) => { finishVisible = resolve; rejectVisible = reject; });
        },
        installResource: async (id) => {
          if (id !== 'pistudio-browser') throw Error('Wrong install scope');
          calls.installs++;
          window.__qa.browser.headlessInstalled = true;
        },
        openTerminalDownload: async () => {
          calls.terminalDownloads++;
        },
        readImageConnection: async () => ({
          keyStored: window.__qa.images === 'ready',
          authentication: window.__qa.images === 'ready' ? 'ready' : 'unchecked',
          modelIds: ['qa-image'],
        }),
        projectCommand: async (request) => {
          if (request.kind !== 'create') throw Error('Wrong project command');
          const project = {
            id: 'qa-created-project',
            name: request.name,
            sourceTeamId: request.teamId,
            createdAt: Date.now(),
            agents: request.agents.map((profile) => ({
              profile,
              outputPath: 'qa-output',
              entries: [],
            })),
          };
          state.projects.push(project);
          return clone({ projects: state.projects, trashProjects: [], selectedId: project.id });
        },
        readProject: async (id) => clone(state.projects.find((project) => project.id === id)),
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
            mcps: ['qa-imported-mcp', 'pistudio-computer', 'pistudio-browser'],
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
            mcps: [
              { ...report.mcps[0], resourceId: importedMcp.id },
              ...['pistudio-computer', 'pistudio-browser'].map((resourceId) => ({
                resourceId,
                authorization: { required: 'no', methods: [], fields: [] },
              })),
            ],
            requiresImages: true,
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
          return new Promise((resolve, reject) => {
            finish = resolve;
            rejectAssistant = reject;
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
      `Array.from(document.querySelectorAll('.topbar nav button')).find(b=>['Начало работы','Onboarding'].includes(b.textContent.trim())).click()`,
    );
  const sidebarChecks = [];
  const checkSidebar = async (language) => {
    await js(`(()=>{const catalog=window.__qa.state.sections.agentCatalog;window.__qa.sidebarOriginal=structuredClone(catalog);const template=catalog.agents[0];for(let i=0;i<18;i++){const id='sidebar-qa-'+i;catalog.agents.push({...structuredClone(template),id,name:'Sidebar QA '+i});catalog.teams[0].agentIds.push(id);}window.dispatchEvent(new Event('focus'));Array.from(document.querySelectorAll('.topbar nav button')).find(b=>['агенты','agents'].includes(b.textContent.trim().toLowerCase())).click();})()`);
    await until(`document.querySelectorAll('.agent-team .agent-list-entry').length>=19`);
    await cdp('Emulation.setDeviceMetricsOverride', {width:900,height:480,deviceScaleFactor:1,mobile:false});
    await until(`innerWidth===900&&innerHeight===480`);
    const geometry = () => js(`(()=>{const list=document.querySelector('.agent-teams-scroll'),system=document.querySelector('.agent-system-list'),r=system.getBoundingClientRect(),pane=document.querySelector('.agent-stages').getBoundingClientRect();return {systemTop:r.top,systemBottom:r.bottom,paneBottom:pane.bottom,listHeight:list.clientHeight,listScroll:list.scrollHeight,bodyOverflow:document.documentElement.scrollHeight>innerHeight+1,headings:Array.from(document.querySelectorAll('.agent-list-group-heading')).map(e=>e.textContent),nav:Array.from(document.querySelectorAll('.topbar nav button')).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height,whiteSpace:getComputedStyle(e).whiteSpace}))}})()`);
    const before=await geometry();
    assert.ok(before.listScroll>before.listHeight);
    assert.ok(Math.abs(before.systemBottom-before.paneBottom)<=1);
    assert.equal(before.bodyOverflow,false);
    assert.ok(before.nav.every(item=>item.whiteSpace==='nowrap'));
    assert.deepEqual(before.headings,language==='ru'?['Мои команды','Системные']:['My teams','System']);
    await js(`document.querySelector('.agent-teams-scroll').scrollTop=100000`);
    const after=await geometry();
    assert.equal(after.systemTop,before.systemTop);
    assert.equal(after.systemBottom,before.systemBottom);
    assert.ok(await js(`document.querySelector('.agent-teams-scroll').scrollTop>0`));
    sidebarChecks.push({language,viewport:[900,480],independentTeamScroll:true,systemSectionPinned:true,translatedHeadings:true,navigationLabelsNoWrap:true});
    await js(`window.__qa.state.sections.agentCatalog=window.__qa.sidebarOriginal;delete window.__qa.sidebarOriginal;window.dispatchEvent(new Event('focus'))`);
    await until(`document.querySelectorAll('.agent-team .agent-list-entry').length===1`);
    await cdp('Emulation.setDeviceMetricsOverride', {width:1100,height:840,deviceScaleFactor:1,mobile:false});
    await open();
    await until(`!!document.querySelector('.onboarding-page')`);
  };
  await until(
    `!!Array.from(document.querySelectorAll('.topbar nav button')).find(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
  );
  // Exercise the real browser status component, including translated network errors, without
  // downloading a component, opening a window, probing permissions or accessing personal data.
  const browserTimeoutChecks = [];
  for (const [language, catalog] of [['ru', ru], ['en', en]]) {
    if (language === 'en') {
      await js(`document.querySelector('.language-select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`);
      await until(`!!document.querySelector('[role="menuitemradio"][lang="en"]')`);
      await js(`document.querySelector('[role="menuitemradio"][lang="en"]').click()`);
    }
    await js(`Array.from(document.querySelectorAll('.topbar nav button')).find(b=>['Агенты','Agents'].includes(b.textContent.trim())).click()`);
    await until(`!!document.querySelector('[data-system-role="assistant"] button')`);
    await js(`document.querySelector('[data-system-role="assistant"] button').click()`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='MCP').click()`);
    const browserRow = `Array.from(document.querySelectorAll('[data-builtin-mcp]')).find(e=>e.textContent.includes(${JSON.stringify(language === 'ru' ? 'Pi Studio · Браузер' : 'Pi Studio · Browser')}))`;
    await until(`!!(${browserRow})`);
    await js(`(()=>{const trigger=(${browserRow}).querySelector('.disclosure-trigger');if(trigger.getAttribute('aria-expanded')==='false')trigger.click()})()`);
    const installLabel = catalog['BrowserResourceStatus.installVisibleBrowser'];
    await until(`(${browserRow}).innerText.includes(${JSON.stringify(installLabel)})`);
    for (const key of ['error.transfer.headerTimeout', 'error.transfer.idleTimeout']) {
      await js(`Array.from((${browserRow}).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(installLabel)}).click()`);
      assert.equal(await js(`Array.from((${browserRow}).querySelectorAll('.resource-native-actions button')).every(b=>b.disabled)`), true);
      await js(`window.__qa.rejectVisible(${JSON.stringify(catalog[key])})`);
      await until(`(${browserRow}).querySelector('[role="status"]')?.textContent===${JSON.stringify(catalog[key])}`);
      assert.equal(await js(`Array.from((${browserRow}).querySelectorAll('.resource-native-actions button')).every(b=>!b.disabled)`), true);
      browserTimeoutChecks.push({ language, key, visibleError: true, retryEnabled: true });
    }
  }
  assert.equal(await js('window.__qa.visibleInstalls'), 4);
  await js(`document.querySelector('.language-select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`);
  await until(`!!document.querySelector('[role="menuitemradio"][lang="ru"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="ru"]').click()`);
  await checkSidebar('ru');
  await open();
  await until(`document.querySelectorAll('.onboarding-list li').length===4`);
  assert.equal(await js(`document.querySelector('#onboarding-heading').textContent`), 'Начало работы');
  assert.deepEqual(
    await js(
      `Array.from(document.querySelector('.onboarding-content').children).map(e=>e.tagName)`,
    ),
    ['H1', 'UL'],
  );
  assert.equal(
    await js(`document.querySelector('button.onboarding-assistant').closest('li').dataset.taskId`),
    'mcp:qa-mcp',
  );
  await js(
    `document.querySelector('.language-select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
  );
  await until(`!!document.querySelector('[role="menuitemradio"][lang="en"]')`);
  await js(`document.querySelector('[role="menuitemradio"][lang="en"]').click()`);
  await until(`document.querySelector('#onboarding-heading')?.textContent==='Onboarding'`);
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
  await until(`document.querySelectorAll('.onboarding-list li[data-complete="true"]').length>=3`);
  await until(
    `document.querySelector('[data-task-id="connection:qa-connection"]')?.dataset.complete==='false'`,
  );
  await js(`document.querySelector('button.onboarding-assistant').click()`);
  await until(`!!document.querySelector('[role="dialog"][aria-label="Receiver"]')`);
  assert.equal(
    await js('window.__qa.calls.assistant'),
    0,
    'Missing helper authorization opens the exact connection editor',
  );
  await js(`document.querySelector('[role="dialog"] .dialog-header button').click()`);
  await js('window.__qa.authorize();window.dispatchEvent(new Event("focus"))');
  await until(
    `document.querySelector('[data-task-id="connection:qa-connection"]')?.dataset.complete==='true'`,
  );
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
    `(()=>{const button=document.querySelector('button.onboarding-assistant');button.click();button.click()})()`,
  );
  await until(
    `document.querySelector('button.onboarding-assistant')?.getAttribute('aria-busy')==='true'`,
  );
  assert.equal(await js('window.__qa.calls.assistant'), 1);
  await js('window.__qa.failAssistant()');
  await until(
    `document.querySelector('[role="alertdialog"]')?.textContent.includes('QA helper failure')`,
  );
  await js(`document.querySelector('[role="alertdialog"] button').click()`);
  await until(`!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('button.onboarding-assistant').click()`);
  await until(`window.__qa.calls.assistant===2`);
  await js('window.__qa.finishAssistant()');
  await until(`!document.querySelector('button.onboarding-assistant')?.disabled`);
  await js(`window.__qa.authorized=false;window.dispatchEvent(new Event('focus'))`);
  await until(
    `document.querySelector('[data-task-id="connection:qa-connection"]')?.dataset.complete==='false'`,
  );
  await js(
    `window.__qa.state.sections.resources[0].check={status:'available',checkedAt:Date.now()};window.dispatchEvent(new Event('focus'))`,
  );
  await js(`document.querySelector('[data-task-id="connection:qa-connection"] button').click()`);
  await until(`!!document.querySelector('[role="dialog"][aria-label="Receiver"]')`);
  await js(`window.__qa.authorize();window.dispatchEvent(new Event('focus'))`);
  await until(
    `!Array.from(document.querySelectorAll('.topbar nav button')).some(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
  );
  assert.equal(
    await js(`!!document.querySelector('[role="dialog"][aria-label="Receiver"]')`),
    true,
    'Finishing setup must preserve the open editor until explicitly closed',
  );
  await js(`document.querySelector('[role="dialog"] .dialog-header button').click()`);
  await until(`!document.querySelector('.onboarding-page')`);
  assert.equal(await js(`!!document.querySelector('.onboarding-page')`), false);
  await js(
    `window.__qa.state.sections.resources[0].check={status:'needs_auth',checkedAt:Date.now()};window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `Array.from(document.querySelectorAll('.topbar nav button')).some(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
  );
  await open();
  await until(`document.querySelector('[data-task-id="mcp:qa-mcp"]')?.dataset.complete==='false'`);
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
  await checkSidebar('en');
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
    `!Array.from(document.querySelectorAll('.topbar nav button')).some(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
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
    2,
    'Import itself must not launch the assistant',
  );
  await until(
    `!!document.querySelector('[data-task-id="mcp:pistudio-computer"]')&&!!document.querySelector('[data-task-id="mcp:pistudio-browser"]')&&!!document.querySelector('[data-task-id="images"]')`,
  );
  assert.equal(
    await js(
      'window.__qa.calls.permissions+window.__qa.calls.installs+window.__qa.calls.terminalDownloads',
    ),
    0,
  );
  await js(`document.querySelector('[data-task-id="mcp:pistudio-computer"] button').click()`);
  await until(`!!document.querySelector('[data-computer-status]')`);
  await js(
    `Array.from(document.querySelectorAll('[data-computer-status] button')).find(b=>b.textContent.trim()==='Разрешить доступ').click()`,
  );
  await until(`window.__qa.calls.permissions===1`);
  await until(
    `document.querySelector('[data-task-id="mcp:pistudio-computer"]')?.dataset.complete==='true'`,
  );
  await js(`document.querySelector('[role="dialog"] .dialog-header button').click()`);
  await js(`document.querySelector('[data-task-id="mcp:pistudio-browser"] button').click()`);
  await until(
    `!!Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.trim()==='Установить компоненты браузера')`,
  );
  await js(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.trim()==='Установить компоненты браузера').click()`,
  );
  await until(`window.__qa.calls.installs===1`);
  await until(
    `document.querySelector('[data-task-id="mcp:pistudio-browser"]')?.dataset.complete==='true'`,
  );
  await js(`document.querySelector('[role="dialog"] .dialog-header button').click()`);
  await js(
    `window.__qa.configureImages();window.__qa.terminal='missing';window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `document.querySelector('[data-task-id="images"]')?.dataset.complete==='true'&&document.querySelector('[data-task-id="terminal"]')?.dataset.complete==='false'`,
  );
  assert.equal(await js('window.__qa.calls.terminalDownloads'), 0);
  await js(`document.querySelector('[data-task-id="terminal"] button').click()`);
  assert.equal(await js('window.__qa.calls.terminalDownloads'), 1);
  await js(
    `window.__qa.terminal='ready';window.__qa.computer.phase='permissions_required';window.__qa.computer.permissions={accessibility:false,screenRecording:false};window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `document.querySelector('[data-task-id="terminal"]')?.dataset.complete==='true'&&document.querySelector('[data-task-id="mcp:pistudio-computer"]')?.dataset.complete==='false'`,
  );
  assert.equal(await js('window.__qa.calls.permissions'), 1, 'Polling never requests consent');
  await screenshot('onboarding-imported-resources.png');
  // A separate empty studio verifies actual create dialogs and ordering, without manually ticking a task.
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?fresh=1` });
  await until(
    `!!Array.from(document.querySelectorAll('.topbar nav button')).find(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
  );
  await open();
  await until(`document.querySelectorAll('.onboarding-list li').length===5`);
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.onboarding-list li')).slice(-3).map(e=>e.dataset.taskId)`,
    ),
    ['create-team', 'create-agent', 'create-project'],
  );
  await screenshot('onboarding-fresh.png');
  await js(`document.querySelector('[data-task-id="create-team"] button').click()`);
  await until(`!!document.querySelector('[role="dialog"] input[aria-label="Название команды"]')`);
  await js(`document.querySelector('[role="dialog"] input').focus()`);
  await cdp('Input.insertText', { text: 'Fresh team' });
  await js(
    `Array.from(document.querySelectorAll('[role="dialog"] .dialog-footer button')).find(b=>b.textContent.trim()==='Создать').click()`,
  );
  await until(
    `!document.querySelector('[role="dialog"]')&&!document.querySelector('[data-task-id="create-team"]')`,
  );
  await js(`document.querySelector('[data-task-id="create-agent"] button').click()`);
  await until(`!!document.querySelector('.agent-editor')`);
  await until(
    `document.querySelector('[data-save-state]')?.dataset.saveState==='idle'&&!document.querySelector('.storage-error')`,
  );
  await until(
    `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
  );
  await open();
  await until(`!document.querySelector('[data-task-id="create-agent"]')`);
  await js(
    `window.__qa.configureModels();window.__qa.authorize();window.dispatchEvent(new Event('focus'))`,
  );
  await until(
    `Array.from(document.querySelectorAll('.onboarding-list li[data-complete="false"]')).length===1&&!!document.querySelector('[data-task-id="create-project"]')`,
  );
  assert.equal(
    await js(`document.querySelector('.onboarding-list li:last-child').dataset.taskId`),
    'create-project',
  );
  await js(`document.querySelector('[data-task-id="create-project"] button').click()`);
  await until(`!!document.querySelector('[role="dialog"] input[aria-label="Название проекта"]')`);
  await js(`document.querySelector('[role="dialog"] input').focus()`);
  await cdp('Input.insertText', { text: 'Fresh project' });
  await js(
    `document.querySelector('[role="dialog"] [role="combobox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
  );
  await until(`!!document.querySelector('[role="option"]')`);
  await js(`document.querySelector('[role="option"]').focus()`);
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await until(
    `Array.from(document.querySelectorAll('[role="dialog"] .dialog-footer button')).some(b=>b.textContent.trim()==='Создать'&&!b.disabled)`,
  );
  await js(
    `Array.from(document.querySelectorAll('[role="dialog"] .dialog-footer button')).find(b=>b.textContent.trim()==='Создать').click()`,
  );
  await until(
    `!document.querySelector('[role="dialog"]')&&!Array.from(document.querySelectorAll('.topbar nav button')).some(b=>['Начало работы','Onboarding'].includes(b.textContent.trim()))`,
  );
  assert.equal(await js('window.__qa.state.projects.length'), 1);
  assert.equal(await js('window.__qa.calls.otherLaunches+window.__qa.calls.assistant'), 0);
  // Failure to prepare Pi cannot be bypassed into the working UI.
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?startup-error=1` });
  await until(`document.body?.textContent?.includes('QA startup')`);
  assert.equal(await js(`!!document.querySelector('.app-shell')`), false);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).some(b=>/без Pi|without Pi/i.test(b.textContent))`,
    ),
    false,
  );

  assert.equal(await js('window.__qa.calls.otherLaunches'), 0);
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    sidebarChecks,
    browserTimeoutChecks,
    missingConnectionAndModelsIncludingAssistant: true,
    realAuthorizationRequired: true,
    creationTasksLastAndImmediatelyRemoved: true,
    projectCreationEndsOnboardingWithoutLaunchingPi: true,
    importedBuiltinPermissionsAndComponents: true,
    revokedPermissionsReopenTaskWithoutConsent: true,
    terminalDownloadOnlyOnExplicitClick: true,
    imagesRequirementFollowsConfiguration: true,
    mandatoryPiHasNoSkip: true,
    completedCircleYellowAndTextStruck: true,
    centeredWithoutHorizontalOverflow: true,
    scopedAssistantDuplicateClicksBlocked: true,
    headingAndTaskListOnly: true,
    assistantActionBelongsToMcpRow: true,
    helperErrorsUseSharedDialog: true,
    automaticHideAndReturn: true,
    importOpensOnboardingAfterProfileHydration: true,
    completedTasksExpireAfterTwoHours: true,
    unresolvedTasksRemain: true,
    themes: ['light', 'dark'],
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
