const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const mainEntry = resolve(process.env.PI_STUDIO_QA_MAIN || 'out/main/index.cjs');
const buildRoot = resolve(mainEntry, '../..');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const copy = {
  en: {
    projects: 'Projects',
    agents: 'Agents',
    create: 'Create project',
    team: 'Landing pages',
    names: ['Audience', 'Offer', 'Page structure', 'Design & code', 'QA & testing'],
    projectsList: ['Forma — landing page', 'Flowdesk — landing page', 'QUIT.BAT — landing page'],
    prompts: [
      'Research the audience for this landing page. Identify practical problems, buying triggers and objections. Use the supplied product brief and verifiable sources. Save findings in audience.md.',
      'Turn audience insights into a clear offer. Define the promise, supporting evidence and calls to action. Save offer.md and explain how each claim is supported.',
      'Choose the landing page type and map the visitor journey. Define sections, content hierarchy and calls to action. Save page-structure.md.',
      'Build the landing page from the approved offer and page structure.\n\n1. Read the research and copy in the current project.\n2. Use a clear typographic hierarchy and a responsive layout.\n3. Keep components reusable and make navigation work with a keyboard.\n4. Implement the page and keep assets local to the project.\n5. Document responsive states and hand off the result for review.\n\nUse only the tools assigned to this agent. Ask about missing requirements before making assumptions.',
      'Review layout, keyboard navigation and content across desktop and mobile widths. Record issues and fixes in responsive-review.md.',
    ],
    markdown:
      '# QUIT.BAT — landing page offer\n\nA game-like AI harness for serious tasks.\n\n## The problem\n\nComplex tasks need repeated prompting and coordination. Users want a team that can follow the process together.\n\n## The offer\n\n**Build a team that knows the next step.**\n\nQUIT.BAT is free and works with Codex and Claude through your subscription. Show the product, explain the workflow and make the download easy to find.\n\n## Page structure\n\n1. A clear promise and a primary call to action.\n2. Three everyday problems the product solves.\n3. A short walkthrough of the workspace.\n4. Product evidence, answers to common questions and a final CTA.\n\n## Next stage\n\nDesign and build the responsive page using this offer and the audience research.\n',
    audience:
      '# Audience research\n\n## Who it is for\n\nDevelopers and creators coordinating multi-step AI work.\n\n## Pain points\n\n- Updates get lost in chat.\n- Responsibilities are unclear.\n- Project files live in several places.\n',
    structure:
      '# Page structure\n\nHero → everyday problems → product walkthrough → evidence → questions → call to action.\n',
  },
  ru: {
    projects: 'Проекты',
    agents: 'Агенты',
    create: 'Создать проект',
    team: 'Лендинги',
    names: ['Аудитория', 'Оффер', 'Структура', 'Разработка', 'Проверка'],
    projectsList: ['Forma — лендинг', 'Flowdesk — лендинг', 'QUIT.BAT — лендинг'],
    prompts: [
      'Исследуйте аудиторию лендинга: реальные проблемы, причины покупки и возражения. Используйте бриф продукта и проверяемые источники. Сохраните выводы в audience.md.',
      'Превратите исследование аудитории в понятный оффер. Определите обещание, подтверждения и призывы к действию. Сохраните offer.md и обоснуйте каждое утверждение.',
      'Выберите тип лендинга и опишите путь посетителя. Определите разделы, иерархию материалов и призывы к действию. Сохраните page-structure.md.',
      'Разработайте лендинг на основе оффера и структуры страницы.\n\n1. Прочитайте исследование и тексты в текущем проекте.\n2. Используйте понятную типографику и адаптивную сетку.\n3. Сделайте компоненты переиспользуемыми, а навигацию доступной с клавиатуры.\n4. Реализуйте страницу и храните материалы внутри проекта.\n5. Опишите состояния для разных экранов и передайте результат на проверку.\n\nИспользуйте только назначенные этому агенту инструменты. Если требований не хватает, задайте вопрос до начала работы.',
      'Проверьте вёрстку, навигацию с клавиатуры и тексты на компьютере и мобильных экранах. Запишите проблемы и исправления в responsive-review.md.',
    ],
    markdown:
      '# QUIT.BAT — оффер для лендинга\n\nAI-харнес для серьёзных задач в игровом интерфейсе.\n\n## Проблема\n\nСложные задачи требуют повторных объяснений и координации. Пользователю нужна команда, которая понимает последовательность работы.\n\n## Оффер\n\n**Команда, которой не нужно объяснять каждый следующий шаг.**\n\nQUIT.BAT бесплатен и работает с Codex и Claude по вашей подписке. Покажите продукт, объясните процесс и сделайте скачивание понятным.\n\n## Структура страницы\n\n1. Понятное обещание и основной призыв к действию.\n2. Три ежедневные проблемы, которые решает продукт.\n3. Короткий обзор рабочего пространства.\n4. Подтверждения, ответы на вопросы и финальный призыв.\n\n## Следующий этап\n\nДизайн и адаптивная разработка страницы на основе оффера и исследования аудитории.\n',
    audience:
      '# Исследование аудитории\n\n## Для кого\n\nРазработчики и авторы, которые поручают ИИ многоэтапную работу.\n\n## Проблемы\n\n- Обновления теряются в чате.\n- Ответственность неочевидна.\n- Файлы проекта хранятся в разных местах.\n',
    structure:
      '# Структура страницы\n\nПервый экран → проблемы аудитории → обзор продукта → подтверждения → вопросы → призыв к действию.\n',
  },
};
const run = (command, args, env = {}) =>
  new Promise((done, fail) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 120000);
    child.once('error', fail);
    child.once('close', (code) => {
      clearTimeout(timeout);
      code === 0 ? done() : fail(Error(output));
    });
  });
async function parent() {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-readme-capture-'));
  const { browserCloneSnapshot, recordBrowserCloneAudit } =
    await import('./mac-browser-clone-audit.mjs');
  const before = await browserCloneSnapshot();
  try {
    const compositor = join(root, 'frame-readme');
    await run('xcrun', ['swiftc', resolve('scripts/frame-readme.swift'), '-o', compositor]);
    const shots = [],
      promptGeometry = [],
      browserCaptures = [];
    for (const language of ['en', 'ru']) {
      await run(
        process.env.PI_STUDIO_CAPTURE_ELECTRON || require('electron'),
        [__filename, '--child', root, language],
        { ELECTRON_RUN_AS_NODE: '' },
      );
      const results = JSON.parse(await readFile(join(root, language, 'capture.json'), 'utf8'));
      for (const shot of results.screenshots) {
        const file = `docs/media/${language}/${shot.name}.png`;
        await mkdir(resolve('docs/media', language), { recursive: true });
        await run(compositor, [join(root, language, shot.name + '.png'), resolve(file)]);
        shots.push({
          ...shot,
          language,
          file,
          sha256: createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        });
      }
      assert.equal(results.forbiddenActions, 0);
      assert.equal(results.sameTeamAndStageOrder, true);
      promptGeometry.push({ language, sizes: results.promptGeometry });
      browserCaptures.push(results.browserCapture);
    }
    const audit = await recordBrowserCloneAudit(process.cwd(), 'readme-capture', before);
    assert.deepEqual(
      audit.newClones,
      [],
      'Review unexpected browser clones; never delete them automatically.',
    );
    const proof = {
      checkedAt: new Date().toISOString(),
      version: require('../package.json').version,
      nativeMainPreloadRenderer: true,
      theme: 'dark',
      languages: ['en', 'ru'],
      screenshots: shots,
      promptGeometry,
      sameTeamAndStageOrder: true,
      promptKeyboardResizeAndFindChecked: true,
      sameProductType: 'landing pages for QUIT.BAT, Forma and Flowdesk',
      sourceMainSha256: createHash('sha256')
        .update(await readFile(mainEntry))
        .digest('hex'),
      sourceRendererSha256: createHash('sha256')
        .update(await readFile(join(buildRoot, 'renderer/index.html')))
        .digest('hex'),
      dataOrigin:
        'Documentation-only landing-page team created through native project IPC. Hand-authored chat, process-list and readiness fixtures; process IDs are illustrative, not live Pi sessions. Browser image is an actual offscreen Chromium capture of the public quitbat.work homepage in the matching language. No model work is represented as completed.',
      browserImageSource: 'https://quitbat.work/',
      browserLanguages: { en: 'en', ru: 'ru' },
      browserCaptures,
      processListOpenOnFirstScreenshot: true,
      chatOpen: true,
      presentation:
        'Unaltered app captures inside a transparent rounded macOS-style presentation frame; traffic lights occupy the app’s reserved native-control area; shadow added by AppKit. See frame-readme.swift.',
      modelRequests: 0,
      terminalOpened: false,
      externalBrowserOpened: false,
      installedAppOrUserStudioChanged: false,
      osFocusChanged: false,
      browserCloneAudit: {
        newClones: audit.newClones,
        noNewRetainedClonesObserved: audit.noNewRetainedClonesObserved,
        browserOrProfileModified: false,
      },
    };
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/readme-screenshots-proof.json',
      JSON.stringify(proof, null, 2) + '\n',
    );
    console.log('Captured and framed eight localized screenshots.');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
async function child() {
  const { app, ipcMain, shell, dialog } = require('electron');
  const root = join(process.argv[3], process.argv[4]),
    language = process.argv[4],
    text = copy[language];
  assert.ok(text && root.includes('pistudio-readme-capture-'));
  const data = join(root, 'UserData'),
    studio = join(root, 'Studio');
  const { mkdirSync, writeFileSync } = require('node:fs');
  mkdirSync(data, { recursive: true });
  mkdirSync(studio);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(join(data, 'appearance.json'), JSON.stringify({ theme: 'dark' }));
  writeFileSync(join(data, 'language.json'), JSON.stringify({ language }));
  app.setPath('userData', data);
  app.setPath('videos', root);
  let forbiddenActions = 0,
    chatState = null,
    processes = [],
    documentationProjectId;
  const documentationRuntime = (project) =>
    project.id !== documentationProjectId
      ? project
      : {
          ...project,
          agents: project.agents.map((agent, index) => ({
            ...agent,
            runStatus: index < 3 ? 'ready' : 'waiting',
            session: {
              id: 'docs-session-' + agent.profile.id,
              title: agent.profile.name,
              path: '.pistudio/sessions/' + agent.profile.id + '/documentation.jsonl',
              createdAt: 1,
            },
          })),
        };
  const prohibited = () => {
    forbiddenActions++;
    throw Error('Documentation capture forbids launch, install, sign-in and OS prompts.');
  };
  shell.openExternal = async () => prohibited();
  shell.openPath = async () => prohibited();
  dialog.showOpenDialog = async () => prohibited();
  dialog.showMessageBoxSync = prohibited;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'Documentation capture' })
        : [
              'studio:launch-agent',
              'studio:open-setup-assistant',
              'studio:resource-install',
              'studio:resource-login',
              'studio:provider-login',
              'studio:connection-login',
              'studio:codex-login',
              'studio:browser-install-visible',
              'studio:computer-permissions',
              'studio:computer-settings',
            ].includes(name)
          ? prohibited
          : name === 'studio:model-catalog'
            ? () => ({ providers: [], models: [] })
            : name === 'studio:load'
              ? async (...args) => {
                  const result = await action(...args);
                  return { ...result, projects: result.projects.map(documentationRuntime) };
                }
              : name === 'studio:read-project'
                ? async (...args) => documentationRuntime(await action(...args))
                : name === 'studio:connection-status'
                  ? () => ({
                      connectionId: 'docs-local',
                      provider: 'documentation',
                      status: 'ready',
                    })
                  : name === 'studio:chat-get'
                    ? () => chatState
                    : name === 'studio:pi-processes'
                      ? () => processes
                      : name === 'studio:onboarding-readiness'
                        ? () => ({
                            folder: studio,
                            terminal: 'ready',
                            terminalRequired: false,
                            git: 'ready',
                            connections: { 'docs-local': 'ready' },
                            mcps: {},
                          })
                        : [
                              'studio:chat-send',
                              'studio:chat-close',
                              'studio:chat-answer',
                              'studio:chat-abort',
                            ].includes(name)
                          ? prohibited
                          : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, value) => {
      value.webContents.setAudioMuted(true);
      value.webContents.once('did-finish-load', () => done(value));
    }),
  );
  const timer = setTimeout(() => app.exit(1), 100000);
  let window;
  try {
    require('./offscreen-main.cjs').loadOffscreenMain(mainEntry);
    window = await loaded;
    window.setSize(1440, 900);
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved capture state');
      app.exit(1);
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(`Boolean(${code})`)) return;
        await new Promise((r) => setTimeout(r, 35));
      }
      throw Error(code + '\n' + (await js('document.body.innerText')));
    };
    const saved = () =>
      until(
        `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
      );
    const click = (name) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`,
      );
    await until(
      `document.documentElement.lang===${JSON.stringify(language)}&&document.documentElement.dataset.theme==='dark'&&document.querySelector('.topbar')`,
    );
    await saved();
    let state = await js('window.studio.loadStudio()');
    assert.deepEqual(state.sections.agentTeams, []);
    assert.deepEqual(state.sections.agents, []);
    const model = {
      connectionId: 'docs-local',
      provider: 'documentation',
      id: language === 'en' ? 'Documentation demo' : 'Демонстрационный диалог',
      reasoning: 'medium',
      temperature: '',
    };
    const connection = {
      id: 'docs-local',
      name: language === 'en' ? 'Local demo' : 'Локальный пример',
      purpose: 'local',
      providerId: model.provider,
      endpoint: 'http://127.0.0.1:9',
      account: '',
      createdAt: 1,
    };
    await js(
      `window.studio.saveSection('connections',${JSON.stringify([connection])},${JSON.stringify({ folder: state.folder, base: state.sections.connections })})`,
    );
    await js(
      `window.studio.saveSection('systemAgents',${JSON.stringify(state.sections.systemAgents.map((a) => ({ ...a, model })))},${JSON.stringify({ folder: state.folder, base: state.sections.systemAgents })})`,
    );
    const agents = text.names.map((name, i) => ({
      id: randomUUID(),
      name,
      enabled: true,
      model,
      mainInstruction: text.prompts[i],
      instructions: [],
      skills: [],
      mcps: [],
      plugins: [],
    }));
    const teamId = randomUUID();
    const catalog = {
      agents,
      teams: [
        {
          id: teamId,
          name: text.team,
          workspaceMode: 'per-agent',
          agentIds: agents.map((a) => a.id),
        },
      ],
    };
    await js(
      `window.studio.saveSection('agentCatalog',${JSON.stringify(catalog)},${JSON.stringify({ folder: state.folder, base: state.sections.agentCatalog })})`,
    );
    let project;
    for (const name of text.projectsList) {
      const result = await js(
        `window.studio.projectCommand(${JSON.stringify({ kind: 'create', name, teamId, agents })})`,
      );
      project = result.projects.find((p) => p.id === result.selectedId);
      assert.ok(project);
    }
    documentationProjectId = project.id;
    const projectRoot = join(studio, 'projects', project.folderName);
    for (const [index, filename, content] of [
      [0, 'audience.md', text.audience],
      [1, 'offer.md', text.markdown],
      [1, 'page-structure.md', text.structure],
    ]) {
      const output = join(projectRoot, project.agents[index].outputPath);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, filename), content);
    }
    await mkdir(join(projectRoot, project.agents[3].outputPath), { recursive: true });
    await writeFile(
      join(projectRoot, project.agents[3].outputPath, 'brief.md'),
      language === 'en'
        ? '# QUIT.BAT landing page\n\nPublic site: https://quitbat.work/\n\nA game-like AI harness for serious tasks. Review the offer, first screen and responsive layout in English.\n'
        : '# Лендинг QUIT.BAT\n\nПубличный сайт: https://quitbat.work/\n\nAI-харнес для серьёзных задач в игровом интерфейсе. Проверьте оффер, первый экран и адаптивную вёрстку на русском.\n',
    );
    await writeFile(
      join(projectRoot, project.agents[3].outputPath, 'responsive-review.md'),
      language === 'en'
        ? '# Responsive review\n\nDesktop preview prepared. Next: mobile layout and keyboard navigation.\n'
        : '# Проверка адаптивности\n\nПодготовлен снимок для компьютера. Далее: мобильная вёрстка и навигация с клавиатуры.\n',
    );
    await saved();
    const reloaded = new Promise((r) => window.webContents.once('did-finish-load', r));
    window.webContents.reload();
    await reloaded;
    await until(
      `document.documentElement.lang===${JSON.stringify(language)}&&document.documentElement.dataset.theme==='dark'&&document.querySelector('.topbar')`,
    );
    await saved();
    const screenshots = [];
    let browserCapture;
    const capture = async (name) => {
      await saved();
      await js(
        `document.activeElement?.blur(); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      await new Promise((r) => setTimeout(r, 180));
      if (name === 'project' || name === 'browser') {
        await js(
          `document.querySelector('.pi-chat-transcript').scrollTop=document.querySelector('.pi-chat-transcript').scrollHeight;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
        );
      }
      const visible = await js('document.body.innerText');
      assert.ok(
        !/Город после дождя|Сценарист|Раскадровка|storyboard|Montage|Preview video|БИБЛИОТЕКА/.test(
          visible,
        ),
      );
      assert.equal(await js('document.documentElement.dataset.theme'), 'dark');
      assert.equal(await js('document.documentElement.lang'), language);
      if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
      const frame = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1440, height: 900, scale: 2 },
      });
      const png = Buffer.from(frame.data, 'base64');
      if (name === 'project' || name === 'browser') {
        assert.equal(
          await js(`!!document.querySelector('.pi-process-popover')`),
          name === 'project',
        );
        assert.equal(
          await js(
            `document.querySelectorAll('.project-agent-launch svg.lucide-message-square').length`,
          ),
          5,
        );
        assert.deepEqual(
          await js(
            `Array.from(document.querySelectorAll('.agent-status-icon')).map(e=>e.dataset.status)`,
          ),
          ['ready', 'ready', 'ready', 'waiting', 'waiting'],
        );
        const geometry = await js(
          `(()=>{const image=document.querySelector('.pi-chat-message > img').getBoundingClientRect();const transcript=document.querySelector('.pi-chat-transcript').getBoundingClientRect();return {imageTop:image.top,imageBottom:image.bottom,transcriptTop:transcript.top,transcriptBottom:transcript.bottom,scrollTop:document.querySelector('.pi-chat-transcript').scrollTop,scrollHeight:document.querySelector('.pi-chat-transcript').scrollHeight,clientHeight:document.querySelector('.pi-chat-transcript').clientHeight,articles:Array.from(document.querySelectorAll('.pi-chat-message')).map(e=>({height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top,role:e.dataset.role}))};})()`,
        );
        assert.ok(
          geometry.imageTop >= geometry.transcriptTop &&
            geometry.imageBottom <= geometry.transcriptBottom,
          JSON.stringify(geometry),
        );
      }
      await writeFile(join(root, name + '.png'), png);
      screenshots.push({
        name,
        rawPixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
        viewport: { width: 1440, height: 900 },
        language,
        theme: 'dark',
        topbarHeight: await js(`document.querySelector('.topbar').getBoundingClientRect().height`),
      });
      console.log(language + ': ' + name);
    };
    await capture('projects');
    await click(text.agents);
    await until(`document.querySelector('.agent-editor')`);
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes(${JSON.stringify(text.names[3])})&&e.classList.contains('agent-list-item')).click()`,
    );
    await until(
      `document.querySelector('textarea')?.value.includes(${JSON.stringify(language === 'en' ? 'Build the landing page' : 'Разработайте лендинг')})`,
    );
    const promptGeometry = [];
    for (const [width, height] of [
      [1080, 720],
      [1440, 900],
    ]) {
      window.setSize(width, height);
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const geometry = await js(
        `(()=>{const field=document.querySelector('.agent-prompt-panel textarea');const footer=document.querySelector('.agent-editor-footer');return {viewport:innerHeight,height:field.getBoundingClientRect().height,bottom:field.getBoundingClientRect().bottom,footerBottom:footer.getBoundingClientRect().bottom,overflow:getComputedStyle(field).overflowY};})()`,
      );
      assert.ok(geometry.bottom <= geometry.viewport - 20, JSON.stringify(geometry));
      assert.ok(geometry.footerBottom <= geometry.viewport - 12, JSON.stringify(geometry));
      assert.equal(geometry.overflow, 'auto');
      promptGeometry.push({ width, ...geometry });
    }
    await until(
      `Number(document.querySelector('.agent-prompt-panel .textarea-resize-handle').getAttribute('aria-valuemax'))===parseFloat(getComputedStyle(document.querySelector('.agent-prompt-panel textarea')).maxHeight)`,
    );
    const promptLimit = await js(
      `(()=>{const h=document.querySelector('.agent-prompt-panel .textarea-resize-handle');h.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));return Number(h.getAttribute('aria-valuemax'));})()`,
    );
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(
      await js(
        `document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`,
      ),
      promptLimit,
    );
    const promptBeforeFind = await js(
      `document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`,
    );
    await js(
      `document.querySelector('.agent-prompt-panel textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',metaKey:true,bubbles:true}))`,
    );
    await until(`document.querySelector('.agent-prompt-panel .textarea-findbar')`);
    assert.equal(
      await js(
        `document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`,
      ),
      promptBeforeFind,
    );
    await js(
      `document.querySelector('.agent-prompt-panel input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('.main-scroll').scrollTop=0`,
    );
    await until(`!document.querySelector('.agent-prompt-panel .textarea-findbar')`);
    await capture('agents');
    await click(text.projects);
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')?.includes(${JSON.stringify(text.projectsList[2])})).click()`,
    );
    await until(
      `document.querySelector('.project-agents')||document.querySelector('.project-column-heading')`,
    );
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.classList.contains('section-menu-item')&&e.textContent.includes(${JSON.stringify(text.names[1])})).click()`,
    );
    await until(
      `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='offer.md')`,
    );
    await click('offer.md');
    await until(
      `document.querySelector('.markdown-preview')||document.body.innerText.includes(${JSON.stringify(language === 'en' ? 'The offer' : 'Оффер')})`,
    );
    // Real public-site Chromium pixels in a fresh memory-only browser session.
    const { BrowserWindow } = require('electron');
    const browser = new BrowserWindow({
      width: 1200,
      height: 760,
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'readme-public-site-' + language,
      },
    });
    browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browser.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) =>
      respond(false),
    );
    browser.webContents.session.webRequest.onBeforeRequest((request, respond) =>
      respond({
        cancel:
          !request.url.startsWith('https://quitbat.work/') && !request.url.startsWith('data:'),
      }),
    );
    try {
      await browser.loadURL('https://quitbat.work/', {
        extraHeaders:
          'Accept-Language: ' + (language === 'ru' ? 'ru-RU,ru;q=0.9' : 'en-US,en;q=0.9') + '\n',
      });
      for (let i = 0; i < 200; i++) {
        if (
          await browser.webContents.executeJavaScript(
            `document.documentElement.lang===${JSON.stringify(language)}&&!!document.querySelector('h1')?.textContent.trim()`,
          )
        )
          break;
        if (i === 199) throw Error('Public site did not render in ' + language);
        await new Promise((r) => setTimeout(r, 50));
      }
      await browser.webContents.executeJavaScript(
        `Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.decode().catch(()=>{}))]).then(()=>true)`,
      );
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(
        await browser.webContents.executeJavaScript('document.documentElement.lang'),
        language,
      );
      const image = await browser.webContents.capturePage();
      const png = image.toPNG();
      browserCapture = {
        url: 'https://quitbat.work/',
        language,
        title: await browser.webContents.executeJavaScript('document.title'),
        heading: await browser.webContents.executeJavaScript(
          'document.querySelector("h1").textContent',
        ),
        viewport: { width: 1200, height: 760 },
        sha256: createHash('sha256').update(png).digest('hex'),
      };
      await mkdir(join(projectRoot, project.agents[3].outputPath), { recursive: true });
      await writeFile(join(projectRoot, project.agents[3].outputPath, 'browser-preview.png'), png);
      const src = 'data:image/png;base64,' + png.toString('base64');
      const ru = language === 'ru';
      const target = { projectId: project.id, agentId: agents[3].id };
      const tool = 'mcp_pi_studio_browser_browser_screenshot';
      chatState = {
        ...target,
        runId: 'documentation-design',
        phase: 'ready',
        working: false,
        revision: 1,
        model: model.id,
        thinkingLevel: 'medium',
        messages: [
          {
            id: 'request',
            role: 'user',
            parts: [
              {
                type: 'text',
                text: ru
                  ? 'Открой quitbat.work в браузере. Проверь первый экран и адаптивность, покажи результат.'
                  : 'Open quitbat.work in the browser. Check the hero and responsive layout, and show me the result.',
              },
            ],
          },
          {
            id: 'plan',
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: ru
                  ? 'Проверяю вёрстку по утверждённому офферу. Начну с первого экрана, затем проверю мобильную версию.'
                  : 'I’ll review the layout against the approved offer, starting with the hero, then check the mobile version.',
              },
            ],
          },
          {
            id: 'call',
            role: 'assistant',
            parts: [
              { type: 'toolCall', id: 'docs-browser-shot', name: tool, arguments: '{}' },
              { type: 'image', src },
              {
                type: 'text',
                text: ru
                  ? 'Первый экран готов к проверке. Далее — мобильная вёрстка и навигация с клавиатуры.'
                  : 'Hero ready for review. Next: mobile layout and keyboard navigation.',
              },
            ],
          },
          {
            id: 'result',
            role: 'toolResult',
            toolCallId: 'docs-browser-shot',
            toolName: tool,
            parts: [
              {
                type: 'text',
                text: ru
                  ? 'QUIT.BAT · 1200 × 760 · первый экран'
                  : 'QUIT.BAT · 1200 × 760 · hero section',
              },
              { type: 'image', src },
            ],
          },
        ],
      };
      processes = [3, 4].map((index, i) => ({
        ...target,
        agentId: agents[index].id,
        runId: 'documentation-' + index,
        pid: 42031 + i,
        agentName: agents[index].name,
        working: false,
        embedded: true,
      }));
      window.webContents.send('studio:chat-changed', target);
      window.webContents.send('studio:chat-opened', target);
      await until(
        `document.querySelector('.pi-chat-panel')&&document.querySelector('.pi-process-indicator')&&document.querySelector('.pi-tool-card')`,
      );
      await until(
        `document.querySelector('.pi-chat-message > img')?.complete&&document.querySelector('.pi-chat-message > img')?.naturalWidth>0`,
      );
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      await js(
        `document.querySelector('.pi-chat-transcript').scrollTop=document.querySelector('.pi-chat-transcript').scrollHeight;document.querySelector('.pi-process-indicator').click()`,
      );
      await until(
        `document.querySelector('.pi-process-popover')&&document.querySelectorAll('.pi-process-row').length===2`,
      );
      await capture('project');
      await js(`document.querySelector('.pi-process-indicator').click()`);
      await until(`!document.querySelector('.pi-process-popover')`);
      await capture('browser');
    } finally {
      browser.destroy();
    }
    state = await js('window.studio.loadStudio()');
    assert.equal(state.projects.length, 3);
    assert.equal(state.sections.agentTeams.length, 1);
    assert.ok(
      state.projects
        .find((p) => p.id === project.id)
        .agents.every((a) => a.session && !a.session.missing),
    );
    assert.equal(
      await js(
        `document.querySelectorAll('.project-agent-launch svg.lucide-message-square').length`,
      ),
      5,
    );
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('.agent-status-icon')).map(e=>e.dataset.status)`,
      ),
      ['ready', 'ready', 'ready', 'waiting', 'waiting'],
    );
    assert.ok(state.projects.every((p) => p.sourceTeamId === teamId));
    assert.ok(
      state.projects.every(
        (p) =>
          JSON.stringify(p.agents.map((a) => a.profile.id)) ===
          JSON.stringify(agents.map((a) => a.id)),
      ),
    );
    assert.ok(
      state.projects.every((p) =>
        p.name.endsWith(language === 'en' ? '— landing page' : '— лендинг'),
      ),
    );
    assert.equal(forbiddenActions, 0);
    await writeFile(
      join(root, 'capture.json'),
      JSON.stringify({
        screenshots,
        forbiddenActions,
        promptGeometry,
        browserCapture,
        sameTeamAndStageOrder: true,
      }),
    );
    await saved();
    window.destroy();
    clearTimeout(timer);
    app.quit();
  } catch (error) {
    clearTimeout(timer);
    console.error(error);
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  }
}
if (process.argv.includes('--child'))
  child().catch((e) => {
    console.error(e);
    require('electron').app.exit(1);
  });
else
  parent().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
