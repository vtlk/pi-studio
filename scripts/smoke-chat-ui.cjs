const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const toolCardsOnly = process.env.PI_STUDIO_QA_TOOL_CARDS_ONLY === '1';

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
    if (toolCardsOnly) {
      const file = 'mcp-tool-cards-ui-proof.json';
      await require('node:fs/promises').copyFile(join(root, file), join('artifacts', file));
      console.log(await readFile(join(root, file), 'utf8'));
      return;
    }
    for (const file of [
      'chat-ui-proof.json',
      'chat-ru-light.png',
      'agents-chat-ru-light.png',
      'agents-chat-ru-dark.png',
      'agents-chat-en-light.png',
      'agents-chat-en-dark.png',
      'chat-en-dark.png',
      'queue-ru-light.png',
      'queue-ru-dark.png',
      'queue-en-light.png',
      'queue-en-dark.png',
      'refresh-ru-light.png',
      'refresh-en-dark.png',
      'tools-ru-light.png',
      'tools-ru-dark.png',
      'tools-en-light.png',
      'tools-en-dark.png',
    ])
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
  const assistant = {
    ...agent,
    id: 'qa-assistant',
    name: 'Помощник настройки',
    systemRole: 'assistant',
  };
  const assistantTarget = { projectId: 'pi-setup-assistant', agentId: assistant.id };
  const assistantState = {
    ...assistantTarget,
    runId: 'helper-run',
    phase: 'ready',
    working: false,
    revision: 1,
    messages: [
      {
        id: 'helper-history',
        role: 'assistant',
        parts: [{ type: 'text', text: 'HELPER_HISTORY' }],
      },
      {
        id: 'helper-follow-up',
        role: 'assistant',
        parts: [{ type: 'text', text: 'HELPER_FOLLOW_UP' }],
      },
    ],
    model: model.id,
    thinkingLevel: 'medium',
  };
  let helperOpens = 0;
  const project = {
    sourceTeamId: 'qa-team',
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
    systemAgents: [assistant],
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
  let refreshEdited = false;
  const refreshCalls = [];
  const refreshReview = (request) => ({
    projectId: target.projectId,
    revision: 'refresh-revision',
    changed: refreshEdited ? [{ id: agent.id, name: agent.name }] : [],
    restarting:
      refreshEdited && request.updateExisting
        ? [
            {
              agentId: agent.id,
              agentName: agent.name,
              runId: 'chat-run',
              sequence: 7,
              working: true,
            },
          ]
        : [],
    removing: [],
  });
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
    'studio:chat-drafts-load': (_, { folder }) => ({ folder, drafts: [] }),
    'studio:chat-drafts-save': (_, { revision }) => ({ revision }),
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
    'studio:prepare-agent-refresh': (_, request) => refreshReview(request),
    'studio:project-command': (_, request) => {
      assert.equal(request.kind, 'update-agents');
      refreshCalls.push(request);
      assert.deepEqual(request.refresh.running, [{ runId: 'chat-run', sequence: 7 }]);
      refreshEdited = false;
      return { projects: [project], trashProjects: [] };
    },
    'studio:chat-get': (_, request) =>
      request.projectId === assistantTarget.projectId ? assistantState : state,
    'studio:setup-assistant': () => {
      helperOpens++;
      processes = [
        {
          ...assistantTarget,
          runId: 'helper-run',
          pid: 32124,
          agentName: assistant.name,
          working: false,
          embedded: true,
        },
      ];
      send('studio:chat-opened', assistantTarget);
      return { runId: 'helper-run' };
    },
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
      if (request.text === 'UI_STEER' || request.text === 'UI_FOLLOWUP') {
        assert.equal(request.behavior, request.text === 'UI_STEER' ? 'steer' : 'followUp');
        state.queue ??= { steering: [], followUp: [] };
        state.queue[request.behavior === 'steer' ? 'steering' : 'followUp'].push(request.text);
        state.revision++;
        send('studio:chat-changed', target);
        return;
      }
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
  const js = (code) =>
    windows.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Chat UI expression:', code);
      throw error;
    });
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
  const loadingHoldMs = process.env.PI_STUDIO_QA_FAST_CHAT_UI ? 1000 : 41000;
  await new Promise((resolve) => setTimeout(resolve, loadingHoldMs));
  assert.equal(await js(`!!document.querySelector('.pi-chat-loading')`), true);
  state.phase = 'ready';
  state.messages = [
    { id: 'old-user', role: 'user', parts: [{ type: 'text', text: 'Сохранённый вопрос' }] },
    {
      id: 'old-answer',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Сохранённый ответ **Pi**.' },
        {
          type: 'toolCall',
          id: 'read-one',
          name: 'read',
          arguments: '{"path":"folder/script.md"}',
        },
        {
          type: 'toolCall',
          id: 'mcp-one',
          name: 'mcp__files__lookup',
          arguments: '{"query":"script"}',
        },
        {
          type: 'toolCall',
          id: 'builtin-settings',
          name: 'mcp__pi_studio__read_agent_settings',
          arguments: JSON.stringify({ agent_id: target.agentId, sections: ['model'] }),
        },
        { type: 'toolCall', id: 'old-missing', name: 'write', arguments: '{"path":"missing.md"}' },
      ],
    },
  ];
  state.messages.push(
    {
      id: 'read-result',
      role: 'toolResult',
      toolCallId: 'read-one',
      toolName: 'read',
      parts: [
        {
          type: 'text',
          text: '# Script\nFull contents <script>window.TOOL_EXECUTED=true</script>',
        },
      ],
    },
    {
      id: 'builtin-settings-result',
      role: 'toolResult',
      toolCallId: 'builtin-settings',
      toolName: 'mcp__pi_studio__read_agent_settings',
      parts: [{ type: 'text', text: '{"settings":"fixture"}' }],
    },
    {
      id: 'mcp-result',
      role: 'toolResult',
      toolCallId: 'mcp-one',
      toolName: 'mcp__files__lookup',
      isError: true,
      parts: [{ type: 'text', text: 'Lookup failed: fixture error' }],
    },
  );
  state.revision++;
  launchResolve({ runId: state.runId, project });
  send('studio:chat-changed', target);
  await until(
    `!document.querySelector('.pi-chat-loading')&&document.querySelectorAll('.pi-chat-message').length===2`,
  );
  const card = (id) => `.pi-tool-card[data-call-id="${id}"]`;
  await until(
    `document.querySelectorAll('.pi-tool-card').length===4&&document.querySelector(${JSON.stringify(card('mcp-one'))}).open`,
  );
  assert.equal(await js(`document.querySelector(${JSON.stringify(card('read-one'))}).open`), false);
  const settingsSummary = await js(
    `document.querySelector('${card('builtin-settings')} summary').innerText`,
  );
  assert.match(settingsSummary, /Чтение настроек агента.*Чат агент/s);
  assert.doesNotMatch(settingsSummary, /mcp__/);
  await js(`document.querySelector('${card('builtin-settings')} summary').click()`);
  await until(`document.querySelector('${card('builtin-settings')}').open`);
  assert.match(
    await js(`document.querySelector('${card('builtin-settings')} .pi-tool-details').innerText`),
    /mcp__pi_studio__read_agent_settings/,
  );
  await js(`document.querySelector('${card('builtin-settings')} summary').click()`);
  assert.equal(
    await js(`document.querySelectorAll('.pi-chat-message[data-role="toolResult"]').length`),
    0,
  );
  assert.equal(await js(`window.TOOL_EXECUTED`), undefined, 'Tool text remains inert');
  assert.match(
    await js(`document.querySelector(${JSON.stringify(card('read-one'))}).innerText`),
    /Прочитан файл.*script.md/s,
  );
  await js(`document.querySelector(${JSON.stringify(card('read-one') + ' summary')}).click()`);
  await until(`document.querySelector(${JSON.stringify(card('read-one'))}).open`);
  assert.match(
    await js(`document.querySelector(${JSON.stringify(card('read-one'))}).innerText`),
    /Параметры.*folder\/script.md.*Результат.*Full contents/s,
  );
  await js(`document.querySelector(${JSON.stringify(card('read-one') + ' summary')}).click()`);
  await js(`document.querySelector(${JSON.stringify(card('mcp-one') + ' summary')}).click()`);
  await until(`!document.querySelector(${JSON.stringify(card('mcp-one'))}).open`);
  // SDK get_messages replaces message IDs after settling. Manual collapse must survive it.
  state.messages = state.messages.map((message, index) => ({ ...message, id: String(index) }));
  state.revision++;
  send('studio:chat-changed', target);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await js(`document.querySelector(${JSON.stringify(card('mcp-one'))}).open`), false);
  // A new error arriving on an existing running card opens exactly once.
  state.messages.push({
    id: 'new-call',
    role: 'assistant',
    parts: [
      { type: 'toolCall', id: 'new-error', name: 'bash', arguments: '{"command":"npm run check"}' },
    ],
  });
  state.working = true;
  state.revision++;
  send('studio:chat-changed', target);
  await until(
    `document.querySelector(${JSON.stringify(card('new-error'))})?.dataset.status==='running'`,
  );
  const senderHeadings = () =>
    js(
      `Array.from(document.querySelectorAll('.pi-chat-transcript > .pi-chat-message'), e => [e.dataset.role, !!e.querySelector(':scope > .pi-chat-role')])`,
    );
  assert.deepEqual(await senderHeadings(), [
    ['user', true],
    ['assistant', true],
    ['assistant', false],
  ]);
  assert.equal(
    await js(`document.querySelector(${JSON.stringify(card('old-missing'))}).dataset.status`),
    'missing',
    'Historical incomplete tools never become active',
  );
  assert.equal(
    await js(`document.querySelector(${JSON.stringify(card('new-error'))}).open`),
    false,
  );
  state.messages.push({
    id: 'new-result',
    role: 'toolResult',
    toolCallId: 'new-error',
    isError: true,
    parts: [{ type: 'text', text: 'Check failed' }],
  });
  state.working = false;
  state.revision++;
  send('studio:chat-changed', target);
  await until(`document.querySelector(${JSON.stringify(card('new-error'))}).open`);
  const toolLocales = [],
    composerLayouts = [];
  for (const [lang, mode] of [
    ['ru', 'light'],
    ['ru', 'dark'],
    ['en', 'light'],
    ['en', 'dark'],
  ]) {
    await js(
      `window.studio.setLanguage(${JSON.stringify(lang)});window.studio.setTheme(${JSON.stringify(mode)})`,
    );
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`,
    );
    const titles = await js(
      `Array.from(document.querySelectorAll('.pi-tool-heading')).map(e=>e.textContent)`,
    );
    assert.match(titles[0], lang === 'ru' ? /Прочитан файл script.md/ : /Read file script.md/);
    assert.match(
      titles[1],
      lang === 'ru' ? /Ошибка: mcp__files__lookup/ : /Error: mcp__files__lookup/,
    );
    const body = await js(`document.querySelector(${JSON.stringify(card('new-error'))}).innerText`);
    assert.match(body, lang === 'ru' ? /Параметры.*Результат/s : /Arguments.*Result/s);
    toolLocales.push({ language: lang, theme: mode, titles });
    const builtinTitle = await js(
      `document.querySelector('${card('builtin-settings')} summary').innerText`,
    );
    assert.match(
      builtinTitle,
      lang === 'ru' ? /Чтение настроек агента.*Чат агент/s : /Reading agent settings.*Чат агент/s,
    );
    assert.doesNotMatch(builtinTitle, /mcp__/);
    if (toolCardsOnly) continue;
    await js(
      `(()=>{const e=document.querySelector('.pi-chat-composer textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,Array.from({length:20},(_,i)=>'Строка / Line '+i).join(String.fromCharCode(10)));e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(e.value.length,e.value.length);})()`,
    );
    await windows.webContents.insertText(' LAST_VISIBLE');
    await until(
      `document.querySelector('.pi-chat-composer textarea').value.endsWith(' LAST_VISIBLE')`,
    );
    const composerLayout = await js(
      `(()=>{const e=document.querySelector('.pi-chat-composer textarea'),g=e.parentElement.querySelector('.textarea-resize-handle'),r=e.getBoundingClientRect(),h=g.getBoundingClientRect();e.scrollTop=e.scrollHeight;return{language:document.documentElement.lang,theme:document.documentElement.dataset.theme,fieldBottom:r.bottom,gripTop:h.top,fieldHeight:r.height,scrollable:e.scrollHeight>e.clientHeight,gripLabel:g.getAttribute('aria-label')}})()`,
    );
    assert.ok(composerLayout.scrollable);
    assert.ok(
      composerLayout.fieldBottom <= composerLayout.gripTop,
      'Resize grip stays outside the actual text viewport',
    );
    assert.equal(
      composerLayout.gripLabel,
      lang === 'ru' ? 'Изменить высоту поля' : 'Resize field height',
    );
    for (const key of ['ArrowDown', 'Home', 'End', 'ArrowUp']) {
      await js(
        `document.querySelector('.pi-chat-composer .textarea-resize-handle').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`,
      );
      assert.equal(
        await js(
          `(()=>{const e=document.querySelector('.pi-chat-composer textarea'),g=e.parentElement.querySelector('.textarea-resize-handle');return e.getBoundingClientRect().bottom<=g.getBoundingClientRect().top})()`,
        ),
        true,
      );
    }
    await js(
      `(()=>{const e=document.querySelector('.pi-chat-composer textarea');e.scrollTop=e.scrollHeight;})()`,
    );
    composerLayouts.push(composerLayout);

    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      join(root, `tools-${lang}-${mode}.png`),
      (await windows.webContents.capturePage()).toPNG(),
    );
  }
  if (toolCardsOnly) {
    await writeFile(
      join(root, 'mcp-tool-cards-ui-proof.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          locales: toolLocales,
          namesInCollapsedBuiltinCards: true,
          rawIdentifierInExpandedDetailsOnly: true,
          scopedOffscreenProfile: true,
        },
        null,
        2,
      ),
    );
    windows.destroy();
    app.exit(0);
    return;
  }
  await js(`window.studio.setLanguage('ru');window.studio.setTheme('light')`);
  await until(
    `document.documentElement.lang==='ru'&&document.documentElement.dataset.theme==='light'`,
  );
  await js(
    `(()=>{const e=document.querySelector('.pi-chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  const geometry = await js(
    `(()=>{const chat=document.querySelector('.pi-chat-panel').getBoundingClientRect(),pane=document.querySelector('.output-preview-pane').getBoundingClientRect(),footer=document.querySelector('.pi-chat-composer').getBoundingClientRect();return{chat:{x:chat.x,y:chat.y,width:chat.width,height:chat.height},pane:{x:pane.x,y:pane.y,width:pane.width,height:pane.height},footerBottom:footer.bottom,chatBottom:chat.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
  );
  assert.equal(geometry.chat.x, geometry.pane.x);
  assert.equal(geometry.chat.width, geometry.pane.width);
  assert.ok(geometry.footerBottom <= geometry.chatBottom + 1);
  assert.equal(geometry.overflow, false);
  const bubbleSpacing = async () => {
    const gaps = await js(
      `(()=>{const bubble=document.querySelector('.pi-chat-message[data-role="user"]'),first=bubble.firstElementChild.getBoundingClientRect(),last=bubble.querySelector('.output-markdown').lastElementChild.getBoundingClientRect(),rect=bubble.getBoundingClientRect();return {top:first.top-rect.top,bottom:rect.bottom-last.bottom}})()`,
    );
    assert.equal(gaps.top, gaps.bottom, 'Message bubble has equal top/bottom padding');
    return gaps;
  };
  const spacing = await bubbleSpacing();
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
  state.messages.push({
    id: 'new-sender-group',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Sender heading returns after the user.' }],
  });
  state.revision++;
  send('studio:chat-changed', target);
  await until(
    `document.querySelector('.pi-chat-transcript').textContent.includes('Sender heading returns after the user.')`,
  );
  assert.deepEqual((await senderHeadings()).slice(-2), [
    ['user', true],
    ['assistant', true],
  ]);
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
  await js(
    `document.querySelector('.pi-chat-composer [role="combobox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until(`!!document.querySelector('[role="option"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent==='Update the current task').click()`,
  );
  await until(`!document.querySelector('[role="option"]')`);
  for (let i = 0; i < 2; i++) {
    await js(
      `(()=>{const e=document.querySelector('.pi-chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'UI_STEER');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(`document.querySelector('.pi-chat-composer textarea').value==='UI_STEER'`);
    await js(
      `document.querySelector('.pi-chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    );
    await until(
      `document.querySelectorAll('[data-queue-kind="steering"]').length===${i + 1}&&document.querySelector('.pi-chat-composer textarea').value===''`,
    );
  }
  await js(
    `window.studio.sendChat({...${JSON.stringify(target)},text:'UI_FOLLOWUP',behavior:'followUp'})`,
  );
  await until(`document.querySelectorAll('[data-queue-kind="followUp"]').length===1`);
  for (const [lang, mode] of [
    ['ru', 'light'],
    ['ru', 'dark'],
    ['en', 'light'],
    ['en', 'dark'],
  ]) {
    await js(
      `window.studio.setLanguage(${JSON.stringify(lang)});window.studio.setTheme(${JSON.stringify(mode)})`,
    );
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`,
    );
    const text = await js(`document.querySelector('.pi-chat-queued').innerText`);
    assert.match(text, lang === 'ru' ? /Steer · в очереди/ : /Steer · queued/);
    assert.match(text, lang === 'ru' ? /После задачи · в очереди/ : /After the task · queued/);
    assert.equal(
      await js(`(() => {
      const working = document.querySelector('.pi-chat-working').getBoundingClientRect();
      return [...document.querySelectorAll('[data-queue-kind]')].every(
        item => item.getBoundingClientRect().top >= working.bottom
      );
    })()`),
      true,
      'Both queue modes appear below the working indicator',
    );
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.pi-chat-message:not([data-queue-kind])')).some(e=>e.textContent.includes('UI_STEER'))`,
      ),
      false,
    );
    await js(`document.querySelector('.pi-chat-transcript').scrollTop=1e9`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      join(root, `queue-${lang}-${mode}.png`),
      (await windows.webContents.capturePage()).toPNG(),
    );
  }
  await js(`document.querySelector('.pi-chat-header button:last-child').click()`);
  await until(`!document.querySelector('.pi-chat-panel')`);
  await js(`document.querySelector('.pi-process-indicator').click()`);
  await until(`!!document.querySelector('.pi-process-row')`);
  await js(`document.querySelector('.pi-process-row').click()`);
  await until(`document.querySelectorAll('[data-queue-kind="steering"]').length===2`);
  assert.equal(launches, 1, 'Reopen keeps the existing native queue without launch');
  // Native delivery removes exactly one identical queue item and adds exactly one history message.
  state.queue.steering.shift();
  state.messages.push({
    id: 'delivered-steer',
    role: 'user',
    parts: [{ type: 'text', text: 'UI_STEER' }],
  });
  state.revision++;
  send('studio:chat-changed', target);
  await until(`document.querySelectorAll('[data-queue-kind="steering"]').length===1`);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.pi-chat-message:not([data-queue-kind])')).filter(e=>e.textContent.includes('UI_STEER')).length`,
    ),
    1,
  );
  for (const lang of ['ru', 'en']) {
    await js(`window.studio.setLanguage(${JSON.stringify(lang)})`);
    await until(`document.documentElement.lang===${JSON.stringify(lang)}`);
    const power = lang === 'ru' ? 'Завершить процесс Pi' : 'Stop Pi process';
    const selector = `.pi-chat-header button[aria-label="${power}"]`;
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.match(
      await js(`document.querySelector('[role="alertdialog"]').innerText`),
      lang === 'ru'
        ? /Сообщения в очереди ещё не записаны в диалог/
        : /Queued messages have not yet been saved to the dialogue/,
    );
    await js(`document.querySelector('[role="alertdialog"] .dialog-footer button').click()`);
    await until(`!document.querySelector('[role="alertdialog"]')`);
  }
  state.phase = 'closed';
  state.revision++;
  send('studio:chat-changed', target);
  for (const lang of ['ru', 'en']) {
    await js(`window.studio.setLanguage(${JSON.stringify(lang)})`);
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.querySelector('.pi-chat-queued')?.textContent.includes(${JSON.stringify(lang === 'ru' ? 'Не доставлено · процесс Pi недоступен' : 'Not delivered · Pi process unavailable')})`,
    );
  }
  state.phase = 'ready';
  state.queue = { steering: [], followUp: [] };
  state.revision++;
  send('studio:chat-changed', target);
  await until(`!document.querySelector('.pi-chat-queued')`);
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
  await bubbleSpacing();
  processes = [];
  state.phase = 'closed';
  state.revision++;
  send('studio:chat-changed', target);
  await until(
    `!document.querySelector('.pi-process-indicator')&&document.querySelector('.pi-chat-panel').innerText.includes('Pi process stopped')`,
  );
  await js(`document.querySelector('.pi-chat-header button:last-child').click()`);
  refreshEdited = true;
  for (const language of ['ru', 'en']) {
    await js(`window.studio.setLanguage(${JSON.stringify(language)})`);
    await until(`document.documentElement.lang===${JSON.stringify(language)}`);
    await js(`document.querySelector('.project-header .button.primary').click()`);
    await until(`!!document.querySelector('.agent-diff')`);
    assert.equal(await js(`document.querySelectorAll('[role="dialog"]').length`), 1);
    assert.equal(
      await js(`!!document.querySelector('.confirmation-backdrop')`),
      false,
      'Refresh immediately opens the comparison without a preliminary confirmation',
    );
    assert.equal(refreshCalls.length, 0, 'Opening comparison does not apply anything');
    await js(`document.querySelector('.dialog:has(.agent-diff) .dialog-footer button').click()`);
    await until(`!document.querySelector('.agent-diff')`);
    assert.equal(refreshCalls.length, 0, 'Cancelling comparison does not apply or restart');
  }
  await js(`document.querySelector('.project-header .button.primary').click()`);
  await until(`!!document.querySelector('.refresh-existing [role="switch"]')`);
  await js(`document.querySelector('.refresh-existing [role="switch"]').click()`);
  const refreshScreens = [];
  for (const [lang, mode] of [
    ['ru', 'light'],
    ['en', 'dark'],
  ]) {
    await js(
      `window.studio.setLanguage(${JSON.stringify(lang)});window.studio.setTheme(${JSON.stringify(mode)})`,
    );
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`,
    );
    await js(`document.querySelector('.dialog:has(.agent-diff) .dialog-footer .primary').click()`);
    const title = lang === 'ru' ? 'Остановить текущие задачи?' : 'Stop the current tasks?';
    const confirmSelector = `[role="alertdialog"][aria-label=${JSON.stringify(title)}]`;
    await until(`!!document.querySelector(${JSON.stringify(confirmSelector)})`);
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(confirmSelector)}).querySelector('.primary').textContent`,
      ),
      lang === 'ru' ? 'Остановить и применить' : 'Stop and apply',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      join(root, `refresh-${lang}-${mode}.png`),
      (await windows.webContents.capturePage()).toPNG(),
    );
    refreshScreens.push({ language: lang, theme: mode, title });
    await js(
      `document.querySelector(${JSON.stringify(confirmSelector)}).querySelector('.dialog-footer button').click()`,
    );
    await until(`document.querySelectorAll('[role="alertdialog"]').length===0`);
    assert.equal(refreshCalls.length, 0, 'Cancel does not apply settings or restart anything');
  }
  await js(`document.querySelector('.dialog:has(.agent-diff) .dialog-footer .primary').click()`);
  await until(
    `!!document.querySelector('[role="alertdialog"][aria-label="Stop the current tasks?"]')`,
  );
  await js(
    `document.querySelector('[role="alertdialog"][aria-label="Stop the current tasks?"] .dialog-footer .primary').click()`,
  );
  await until(`!document.querySelector('.agent-diff')`);
  assert.equal(refreshCalls.length, 1);
  await clickText('Agents');
  await until(`!!document.querySelector('.agents-workspace')`);
  await js(`document.querySelector('[data-system-role="assistant"] .agent-helper-launch').click()`);
  await until(
    `document.querySelectorAll('.pi-chat-panel').length===1&&document.querySelector('.pi-chat-panel').innerText.includes('HELPER_HISTORY')`,
  );
  assert.deepEqual(await senderHeadings(), [
    ['assistant', true],
    ['assistant', false],
  ]);
  await js(
    `(()=>{const e=document.querySelector('.pi-chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'HELPER_DRAFT');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(`document.querySelector('.pi-chat-composer textarea').value==='HELPER_DRAFT'`);
  const assistantLayouts = [];
  const measureAssistant = async () =>
    js(
      `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},chat=rect(document.querySelector('.pi-chat-panel')),editor=rect(document.querySelector('.agent-editor')),list=rect(document.querySelector('.agent-stages')),workspace=rect(document.querySelector('.agents-workspace'));return{chat,editor,list,workspace,overflow:document.documentElement.scrollWidth>innerWidth,sidebarAccessible:!!document.elementFromPoint(list.right-10,list.y+60)?.closest('.agent-stages'),panels:document.querySelectorAll('.pi-chat-panel').length}})()`,
    );
  const checkAssistant = async () => {
    await until(
      `Math.abs(document.querySelector('.pi-chat-panel').getBoundingClientRect().x-document.querySelector('.agent-editor').getBoundingClientRect().x)<0.1`,
    );
    const r = await measureAssistant();
    assert.equal(r.chat.x, r.list.right);
    assert.equal(r.chat.x, r.editor.x);
    assert.equal(r.chat.width, r.editor.width);
    assert.equal(r.chat.y, r.workspace.y);
    assert.equal(r.chat.bottom, r.workspace.bottom);
    assert.equal(r.sidebarAccessible, true);
    assert.equal(r.overflow, false);
    assert.equal(r.panels, 1);
    return r;
  };
  for (const [lang, mode] of [
    ['ru', 'light'],
    ['ru', 'dark'],
    ['en', 'light'],
    ['en', 'dark'],
  ]) {
    await js(
      `window.studio.setLanguage(${JSON.stringify(lang)});window.studio.setTheme(${JSON.stringify(mode)})`,
    );
    await until(
      `document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`,
    );
    assert.equal(
      await js(`document.querySelector('.pi-chat-header h2').textContent`),
      lang === 'ru' ? 'Помощник настройки' : 'Setup assistant',
    );
    assert.equal(
      await js(`document.querySelector('.agent-list-group-heading').textContent`),
      lang === 'ru' ? 'Мои команды' : 'My teams',
    );
    for (const [width, height] of [
      [1080, 480],
      [1280, 740],
      [1760, 740],
    ]) {
      windows.setContentSize(width, height);
      await until(`innerWidth===${width}&&innerHeight===${height}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const layout = await checkAssistant();
      assistantLayouts.push({ language: lang, theme: mode, width, height, ...layout });
      assert.equal(
        await js(`document.querySelector('.pi-chat-composer textarea').value`),
        'HELPER_DRAFT',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      join(root, `agents-chat-${lang}-${mode}.png`),
      (await windows.webContents.capturePage()).toPNG(),
    );
  }
  windows.setContentSize(1280, 740);
  await until(`innerWidth===1280`);
  send('studio:run-failure', {
    ...target,
    projectRoot: join(bootstrap.folder, 'projects/chat-project'),
    agentName: 'QA',
    failure: 'network',
  });
  await until(`!!document.querySelector('.run-failure-notice')`);
  await checkAssistant();
  await js(`document.querySelector('.run-failure-notice button').click()`);
  await until(`!document.querySelector('.run-failure-notice')`);
  // Navigating moves the panel between its page-specific hosts without opening Pi again.
  await clickText('Projects');
  await until(
    `!!document.querySelector('.pi-chat-standalone')&&!document.querySelector('.agents-workspace')`,
  );
  assert.equal(
    await js(`document.querySelector('.pi-chat-composer textarea').value`),
    'HELPER_DRAFT',
  );
  assert.equal(
    await js(`Math.round(document.querySelector('.pi-chat-panel').getBoundingClientRect().width)`),
    800,
  );
  await clickText('Agents');
  await until(`!!document.querySelector('.agents-workspace > .pi-chat-panel')`);
  await checkAssistant();
  assert.equal(
    await js(`document.querySelector('.pi-chat-composer textarea').value`),
    'HELPER_DRAFT',
  );
  assert.equal(helperOpens, 1, 'Page navigation reuses the same helper process');
  assert.ok(!errors.length, errors.join('\n'));
  await writeFile(
    join(root, 'chat-ui-proof.json'),
    JSON.stringify(
      {
        ok: true,
        scope:
          'isolated offscreen real renderer/preload + controlled IPC; native Windows acceptance remains separate',
        checks: [
          `${loadingHoldMs / 1000}-second loading spinner`,
          'one launch for double click',
          'preview-sized sliding panel',
          'Agents helper chat reaches the team-column edge at 1080/1280/1760px, short height and RU/EN/light/dark',
          'team column remains clickable; one chat; notification-aware bounds; navigation preserves helper draft and process',
          'footer/overflow geometry',
          'equal message-bubble vertical padding',
          'sender headings group across tool results and return after author changes in shared chat views',
          'authoritative native queue visible after composer steer sends, duplicates preserved',
          'both native queue modes render below the working indicator in RU/EN and both themes',
          'queued steer/follow-up translated in RU/EN/light/dark and delivery avoids duplicate history',
          'tool calls/results paired once by native ID',
          'success collapsed; initial and arriving errors auto-open',
          'manual collapse survives SDK message ID replacement',
          'historical incomplete tools stay inactive; output remains inert',
          'tool summary/details translated in RU/EN and both themes',
          'multiline composer scroll and keyboard resize keep grip outside text viewport in RU/EN/light/dark',
          'RU/EN refresh confirmation and cancel without mutation',
          'refresh consent carries exact run and task sequence',
          'RU/EN in light/dark',
          'yellow process count and hidden zero',
          'hide/reopen without launch',
          'retained draft',
          'send with Enter',
          'stop without exit',
          'closed state without spinner',
        ],
        geometry,
        spacing,
        refreshOpensComparisonImmediatelyInRussianAndEnglish: true,
        refreshComparisonCancelPreservesState: true,
        refreshScreens,
        toolLocales,
        composerLayouts,
        assistantLayouts,
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
