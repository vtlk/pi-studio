const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-chat-ui-')));
  try {
    await new Promise((done, fail) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (b) => (log += b));
      child.stderr.on('data', (b) => (log += b));
      const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
      child.once('error', fail);
      child.once('exit', (code) => {
        clearTimeout(timer);
        code ? fail(Error(log)) : done();
      });
    });
    await mkdir('artifacts', { recursive: true });
    for (const file of ['chat-ui-proof.json', 'chat-ru-light.png', 'chat-en-dark.png'])
      await require('node:fs/promises').copyFile(join(root, file), join('artifacts', file));
    console.log(await readFile(join(root, 'chat-ui-proof.json'), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
async function child() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const root = process.argv[3],
    data = join(root, 'UserData');
  await mkdir(data);
  app.setPath('userData', data);
  require('./offscreen-main.cjs').configureQaRuntime();
  let language = 'ru',
    theme = 'light',
    windows,
    launchResolve,
    launches = 0,
    sends = 0,
    stopped = 0;
  const target = { projectId: 'chat-project', agentId: 'chat-agent' };
  const model = {
    connectionId: 'qa-chat',
    provider: 'openai-codex',
    id: 'qa-chat-model',
    reasoning: 'Средний',
    temperature: '',
  };
  const agent = {
    id: target.agentId,
    name: 'Чат агент',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model,
  };
  const project = {
    schemaVersion: 1,
    id: target.projectId,
    name: 'Chat UI QA',
    createdAt: 1,
    agents: [
      {
        profile: agent,
        outputPath: 'agents/chat/output',
        entries: [],
        session: {
          id: 'exact-dialogue',
          path: '.pistudio/sessions/chat-agent/exact.jsonl',
          title: agent.name,
          createdAt: 1,
        },
      },
    ],
  };
  const sections = {
    agents: [agent],
    systemAgents: [],
    resources: [],
    connections: [
      {
        id: 'qa-chat',
        name: 'QA',
        purpose: 'codex',
        providerId: 'openai-codex',
        endpoint: '',
        account: '',
        createdAt: 1,
      },
    ],
    agentTeams: [{ id: 'qa-team', name: 'QA', agentIds: [agent.id], createdAt: 1 }],
  };
  sections.agentCatalog = { agents: [agent], teams: sections.agentTeams };
  const bootstrap = {
    folder: join(root, 'Studio'),
    sections,
    projects: [project],
    trashProjects: [],
    warnings: [],
  };
  let state = null,
    processes = [];
  const send = (channel, value) => windows.webContents.send(channel, value);
  const themeState = () => ({ preference: theme, theme, revision: 1 });
  const languageState = () => ({ preference: language, language, revision: 1 });
  const handlers = {
    'studio:language': languageState,
    'studio:language-set': (_, value) => {
      language = value;
      send('studio:language-changed', languageState());
      return languageState();
    },
    'studio:theme': themeState,
    'studio:theme-set': (_, value) => {
      theme = value;
      send('studio:theme-changed', themeState());
      return themeState();
    },
    'studio:update-state': () => ({ phase: 'idle', currentVersion: '0.2.0-alpha.99' }),
    'studio:update-readiness': () => {},
    'studio:github-star-state': () => ({
      due: false,
      disabled: false,
      canPresent: false,
      revision: 1,
    }),
    'studio:get-info': () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
    'studio:startup': () => ({ phase: 'ready', message: 'QA' }),
    'studio:load': () => bootstrap,
    'studio:list-project-activity': () => [],
    'studio:list-project-usage': () => [],
    'studio:read-project': () => project,
    'studio:save-section': (_, section, value) => ({ saved: true, value }),
    'studio:onboarding-readiness': () => ({
      folder: bootstrap.folder,
      terminal: 'ready',
      terminalRequired: false,
      git: 'ready',
      connections: { 'qa-chat': 'ready' },
      mcps: {},
    }),
    'studio:list-team-imports': () => [],
    'studio:list-team-messages': () => [],
    'studio:chat-get': () => state,
    'studio:pi-processes': () => processes,
    'studio:launch-agent': (_, request) => {
      launches++;
      assert.equal(request.agentId, agent.id);
      state = {
        ...target,
        runId: 'chat-run',
        phase: 'opening',
        working: false,
        revision: 1,
        messages: [],
        model: model.id,
        thinkingLevel: 'medium',
      };
      processes = [
        {
          ...target,
          runId: 'chat-run',
          pid: 32123,
          agentName: agent.name,
          working: false,
          embedded: true,
        },
      ];
      send('studio:chat-changed', target);
      return new Promise((resolve) => {
        launchResolve = resolve;
      });
    },
    'studio:chat-send': (_, request) => {
      sends++;
      assert.equal(request.text, 'UI_MESSAGE');
      state.messages.push({
        id: 'user',
        role: 'user',
        parts: [{ type: 'text', text: request.text }],
      });
      state.revision++;
      send('studio:chat-changed', target);
    },
    'studio:chat-abort': () => {
      stopped++;
      state.working = false;
      state.revision++;
      send('studio:chat-changed', target);
    },
    'studio:chat-close': () => {
      processes = [];
      state.phase = 'closed';
      state.revision++;
      send('studio:chat-changed', target);
    },
    'studio:release-reference-files': () => {},
    'studio:connection-status': () => ({
      connectionId: 'qa-chat',
      provider: 'openai-codex',
      status: 'ready',
    }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  await app.whenReady();
  windows = new BrowserWindow({
    show: false,
    width: 1280,
    height: 740,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      sandbox: true,
      preload: resolve('out/preload/index.cjs'),
      backgroundThrottling: false,
    },
  });
  windows.webContents.setAudioMuted(true);
  const errors = [];
  windows.webContents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes('No handler registered'))
      errors.push(details.message);
  });
  await windows.loadFile(resolve('out/renderer/index.html'));
  windows.webContents.debugger.attach('1.3');
  await windows.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const js = (code) => windows.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 250; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error(code + '\n' + (await js('document.body.innerText')));
  };
  const clickText = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await until(
    `!!document.querySelector('.project-list-row')||!!document.querySelector('.projects-table')||document.body.innerText.includes('Chat UI QA')`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Chat UI QA')).click()`,
  );
  await until(`!!document.querySelector('.project-agent-launch')`);
  assert.equal(await js(`!!document.querySelector('.pi-process-indicator')`), false);
  await js(
    `document.querySelector('.project-agent-launch').click();document.querySelector('.project-agent-launch').click()`,
  );
  await until(
    `!!document.querySelector('.pi-chat-loading')&&!!document.querySelector('.pi-process-indicator')`,
  );
  assert.equal(launches, 1, 'Double click launches once');
  assert.equal(
    await js(`document.querySelector('.pi-chat-loading').getAttribute('role')`),
    'status',
  );
  const color = await js(
    `getComputedStyle(document.querySelector('.pi-process-indicator')).backgroundColor`,
  );
  assert.equal(color, 'rgb(255, 212, 71)');
  assert.equal(await js(`document.querySelector('.pi-process-indicator').textContent`), '1');
  assert.match(
    await js(`document.querySelector('.pi-process-indicator').getAttribute('aria-label')`),
    /1 процесс Pi/,
  );
  // Simulate the long Windows startup without a native Windows/desktop permission probe.
  await new Promise((resolve) => setTimeout(resolve, 41000));
  assert.equal(await js(`!!document.querySelector('.pi-chat-loading')`), true);
  state.phase = 'ready';
  state.messages = [
    { id: 'old-user', role: 'user', parts: [{ type: 'text', text: 'Сохранённый вопрос' }] },
    {
      id: 'old-answer',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Сохранённый ответ **Pi**.' },
        { type: 'toolCall', name: 'read', arguments: '{"path":"result.md"}' },
      ],
    },
  ];
  state.revision++;
  launchResolve({ runId: state.runId, project });
  send('studio:chat-changed', target);
  await until(
    `!document.querySelector('.pi-chat-loading')&&document.querySelectorAll('.pi-chat-message').length===2`,
  );
  const geometry = await js(
    `(()=>{const chat=document.querySelector('.pi-chat-panel').getBoundingClientRect(),pane=document.querySelector('.output-preview-pane').getBoundingClientRect(),footer=document.querySelector('.pi-chat-composer').getBoundingClientRect();return{chat:{x:chat.x,y:chat.y,width:chat.width,height:chat.height},pane:{x:pane.x,y:pane.y,width:pane.width,height:pane.height},footerBottom:footer.bottom,chatBottom:chat.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
  );
  assert.equal(geometry.chat.x, geometry.pane.x);
  assert.equal(geometry.chat.width, geometry.pane.width);
  assert.ok(geometry.footerBottom <= geometry.chatBottom + 1);
  assert.equal(geometry.overflow, false);
  await writeFile(
    join(root, 'chat-ru-light.png'),
    (await windows.webContents.capturePage()).toPNG(),
  );
  await js(
    `(()=>{const e=document.querySelector('.pi-chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'KEEP_DRAFT');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(`document.querySelector('[data-unsaved-draft="true"]')!==null`);
  await js(`document.querySelector('.pi-chat-header button:last-child').click()`);
  await until(`!document.querySelector('.pi-chat-panel')`);
  assert.equal(
    await js(`document.querySelector('.pi-process-indicator').textContent`),
    '1',
    'Hiding chat does not stop the process',
  );
  await js(`document.querySelector('.pi-process-indicator').click()`);
  await until(`!!document.querySelector('.pi-process-row')`);
  await js(`document.querySelector('.pi-process-row').click()`);
  await until(`!!document.querySelector('.pi-chat-panel')`);
  assert.equal(launches, 1, 'Process menu reopens without launch');
  assert.equal(
    await js(`document.querySelector('.pi-chat-composer textarea').value`),
    'KEEP_DRAFT',
  );
  await js(
    `(()=>{const e=document.querySelector('.pi-chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'UI_MESSAGE');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(`document.querySelector('.pi-chat-composer textarea').value==='UI_MESSAGE'`);
  await js(
    `document.querySelector('.pi-chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until(`document.querySelector('.pi-chat-composer textarea').value===''`);
  assert.equal(sends, 1);
  await js(`window.studio.setLanguage('en');window.studio.setTheme('dark')`);
  await until(
    `document.documentElement.lang==='en'&&document.documentElement.dataset.theme==='dark'`,
  );
  assert.match(
    await js(`document.querySelector('.pi-chat-composer textarea').placeholder`),
    /Shift\+Enter/,
  );
  assert.equal(
    await js(
      `document.querySelector('.pi-chat-header button:last-child').getAttribute('aria-label')`,
    ),
    'Hide chat — Pi keeps running',
  );
  assert.equal(
    await js(`/[А-Яа-яЁё]/.test(document.querySelector('.pi-chat-composer').innerText)`),
    false,
    'English controls are translated',
  );
  state.working = true;
  state.revision++;
  send('studio:chat-changed', target);
  await until(`!!document.querySelector('.pi-chat-working')`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await writeFile(
    join(root, 'chat-en-dark.png'),
    (await windows.webContents.capturePage()).toPNG(),
  );
  await js(`document.querySelector('button[aria-label="Stop current work"]').click()`);
  await until(`!document.querySelector('.pi-chat-working')`);
  assert.equal(stopped, 1);
  for (const [lang, selectedTheme] of [
    ['ru', 'dark'],
    ['en', 'light'],
  ]) {
    await js(
      `window.studio.setLanguage(${JSON.stringify(lang)});window.studio.setTheme(${JSON.stringify(selectedTheme)})`,
    );
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dataset.theme===${JSON.stringify(selectedTheme)}`,
    );
    assert.equal(
      await js(`document.querySelector('.pi-chat-composer textarea').getAttribute('aria-label')`),
      lang === 'ru' ? 'Сообщение агенту' : 'Message to the agent',
    );
  }
  processes = [];
  state.phase = 'closed';
  state.revision++;
  send('studio:chat-changed', target);
  await until(
    `!document.querySelector('.pi-process-indicator')&&document.querySelector('.pi-chat-panel').innerText.includes('Pi process stopped')`,
  );
  assert.ok(!errors.length, errors.join('\n'));
  await writeFile(
    join(root, 'chat-ui-proof.json'),
    JSON.stringify(
      {
        ok: true,
        scope:
          'isolated offscreen real renderer/preload + controlled IPC; native Windows acceptance remains separate',
        checks: [
          '41-second loading spinner',
          'one launch for double click',
          'preview-sized sliding panel',
          'footer/overflow geometry',
          'RU/EN in light/dark',
          'yellow process count and hidden zero',
          'hide/reopen without launch',
          'retained draft',
          'send with Enter',
          'stop without exit',
          'closed state without spinner',
        ],
        geometry,
      },
      null,
      2,
    ),
  );
  windows.destroy();
  app.exit(0);
}
(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  if (process.argv.includes('--child')) require('electron').app.exit(1);
  else process.exitCode = 1;
});
