const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const copy = {
  en: {
    projects: 'Projects', agents: 'Agents', create: 'Create project',
    team: 'Landing pages',
    names: ['Audience', 'Offer', 'Page structure', 'Design & code', 'QA & testing'],
    projectsList: ['Forma — landing page', 'Flowdesk — landing page', 'Atlas — landing page'],
    prompts: [
      'Research the audience for this landing page. Identify practical problems, buying triggers and objections. Use the supplied product brief and verifiable sources. Save findings in audience.md.',
      'Turn audience insights into a clear offer. Define the promise, supporting evidence and calls to action. Save offer.md and explain how each claim is supported.',
      'Choose the landing page type and map the visitor journey. Define sections, content hierarchy and calls to action. Save page-structure.md.',
      'Build the landing page from the approved offer and page structure.\n\n1. Read the research and copy in the current project.\n2. Use a clear typographic hierarchy and a responsive layout.\n3. Keep components reusable and make navigation work with a keyboard.\n4. Implement the page and keep assets local to the project.\n5. Document responsive states and hand off the result for review.\n\nUse only the tools assigned to this agent. Ask about missing requirements before making assumptions.',
      'Review layout, keyboard navigation and content across desktop and mobile widths. Record issues and fixes in responsive-review.md.',
    ],
    markdown: '# Atlas — landing page offer\n\nA workspace for small teams that want to keep projects moving.\n\n## The problem\n\nTasks, decisions and files are scattered across chats and documents. Teams lose time finding the next action.\n\n## The offer\n\n**Give every project a clear next step.**\n\nPlan the work, keep the context together and see what needs attention in one shared workspace.\n\n## Page structure\n\n1. A clear promise and a primary call to action.\n2. Three everyday problems the product solves.\n3. A short walkthrough of the workspace.\n4. Product evidence, answers to common questions and a final CTA.\n\n## Next stage\n\nDesign and build the responsive page using this offer and the audience research.\n',
    audience: '# Audience research\n\n## Who it is for\n\nSmall service teams managing several client projects.\n\n## Pain points\n\n- Updates get lost in chat.\n- Responsibilities are unclear.\n- Project files live in several places.\n',
    structure: '# Page structure\n\nHero → everyday problems → product walkthrough → evidence → questions → call to action.\n',
  },
  ru: {
    projects: 'Проекты', agents: 'Агенты', create: 'Создать проект',
    team: 'Лендинги',
    names: ['Аудитория', 'Оффер', 'Структура', 'Разработка', 'Проверка'],
    projectsList: ['Forma — лендинг', 'Flowdesk — лендинг', 'Atlas — лендинг'],
    prompts: [
      'Исследуйте аудиторию лендинга: реальные проблемы, причины покупки и возражения. Используйте бриф продукта и проверяемые источники. Сохраните выводы в audience.md.',
      'Превратите исследование аудитории в понятный оффер. Определите обещание, подтверждения и призывы к действию. Сохраните offer.md и обоснуйте каждое утверждение.',
      'Выберите тип лендинга и опишите путь посетителя. Определите разделы, иерархию материалов и призывы к действию. Сохраните page-structure.md.',
      'Разработайте лендинг на основе оффера и структуры страницы.\n\n1. Прочитайте исследование и тексты в текущем проекте.\n2. Используйте понятную типографику и адаптивную сетку.\n3. Сделайте компоненты переиспользуемыми, а навигацию доступной с клавиатуры.\n4. Реализуйте страницу и храните материалы внутри проекта.\n5. Опишите состояния для разных экранов и передайте результат на проверку.\n\nИспользуйте только назначенные этому агенту инструменты. Если требований не хватает, задайте вопрос до начала работы.',
      'Проверьте вёрстку, навигацию с клавиатуры и тексты на компьютере и мобильных экранах. Запишите проблемы и исправления в responsive-review.md.',
    ],
    markdown: '# Atlas — оффер для лендинга\n\nРабочее пространство для небольших команд, которые хотят двигать проекты вперёд.\n\n## Проблема\n\nЗадачи, решения и файлы разбросаны по чатам и документам. Команда тратит время на поиск следующего действия.\n\n## Оффер\n\n**У каждого проекта — понятный следующий шаг.**\n\nПланируйте работу, сохраняйте контекст и смотрите, что требует внимания, в одном командном пространстве.\n\n## Структура страницы\n\n1. Понятное обещание и основной призыв к действию.\n2. Три ежедневные проблемы, которые решает продукт.\n3. Короткий обзор рабочего пространства.\n4. Подтверждения, ответы на вопросы и финальный призыв.\n\n## Следующий этап\n\nДизайн и адаптивная разработка страницы на основе оффера и исследования аудитории.\n',
    audience: '# Исследование аудитории\n\n## Для кого\n\nНебольшие сервисные команды с несколькими клиентскими проектами.\n\n## Проблемы\n\n- Обновления теряются в чате.\n- Ответственность неочевидна.\n- Файлы проекта хранятся в разных местах.\n',
    structure: '# Структура страницы\n\nПервый экран → проблемы аудитории → обзор продукта → подтверждения → вопросы → призыв к действию.\n',
  },
};
const run = (command, args, env = {}) => new Promise((done, fail) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 120000);
  child.once('error', fail);
  child.once('close', (code) => { clearTimeout(timeout); code === 0 ? done() : fail(Error(output)); });
});
async function parent() {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-readme-capture-'));
  const { browserCloneSnapshot, recordBrowserCloneAudit } = await import('./mac-browser-clone-audit.mjs');
  const before = await browserCloneSnapshot();
  try {
    const compositor = join(root, 'frame-readme');
    await run('xcrun', ['swiftc', resolve('scripts/frame-readme.swift'), '-o', compositor]);
    const shots = [], promptGeometry = [];
    for (const language of ['en', 'ru']) {
      await run(require('electron'), [__filename, '--child', root, language], { ELECTRON_RUN_AS_NODE: '' });
      const results = JSON.parse(await readFile(join(root, language, 'capture.json'), 'utf8'));
      for (const shot of results.screenshots) {
        const file = `docs/media/${language}/${shot.name}.png`;
        await mkdir(resolve('docs/media', language), { recursive: true });
        await run(compositor, [join(root, language, shot.name + '.png'), resolve(file)]);
        shots.push({ ...shot, language, file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
      }
      assert.equal(results.forbiddenActions, 0);
      assert.equal(results.sameTeamAndStageOrder, true);
      promptGeometry.push({ language, sizes: results.promptGeometry });
    }
    const audit = await recordBrowserCloneAudit(process.cwd(), 'readme-capture', before);
    assert.deepEqual(audit.newClones, [], 'Review unexpected browser clones; never delete them automatically.');
    const proof = {
      checkedAt: new Date().toISOString(), version: require('../package.json').version,
      nativeMainPreloadRenderer: true, theme: 'dark', languages: ['en', 'ru'],
      screenshots: shots, promptGeometry, sameTeamAndStageOrder: true,
      promptKeyboardResizeAndFindChecked: true,
      sameProductType: 'landing pages for Atlas, Forma and Flowdesk',
      sourceMainSha256: createHash('sha256').update(await readFile('out/main/index.cjs')).digest('hex'),
      sourceRendererSha256: createHash('sha256').update(await readFile('out/renderer/index.html')).digest('hex'),
      dataOrigin: 'Documentation-only landing-page team, project CRUD via real native IPC and hand-authored local Markdown. No model work is represented as completed.',
      presentation: 'Unaltered app captures inside a transparent rounded macOS-style presentation frame; traffic lights occupy the app’s reserved native-control area; shadow added by AppKit. See frame-readme.swift.',
      modelRequests: 0, terminalOpened: false, externalBrowserOpened: false,
      installedAppOrUserStudioChanged: false, osFocusChanged: false,
      browserCloneAudit: { newClones: audit.newClones, noNewRetainedClonesObserved: audit.noNewRetainedClonesObserved, browserOrProfileModified: false },
    };
    await writeFile('docs/media/screenshots-proof.json', JSON.stringify(proof, null, 2) + '\n');
    console.log('Captured and framed six localized screenshots.');
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
async function child() {
  const { app, ipcMain, shell, dialog } = require('electron');
  const root = join(process.argv[3], process.argv[4]), language = process.argv[4], text = copy[language];
  assert.ok(text && root.includes('pistudio-readme-capture-'));
  const data = join(root, 'UserData'), studio = join(root, 'Studio');
  const { mkdirSync, writeFileSync } = require('node:fs');
  mkdirSync(data, { recursive: true }); mkdirSync(studio);
  writeFileSync(join(data, 'workspace.json'), JSON.stringify({ folder: studio }));
  writeFileSync(join(data, 'appearance.json'), JSON.stringify({ theme: 'dark' }));
  writeFileSync(join(data, 'language.json'), JSON.stringify({ language }));
  app.setPath('userData', data); app.setPath('videos', root);
  let forbiddenActions = 0;
  const prohibited = () => { forbiddenActions++; throw Error('Documentation capture forbids launch, install, sign-in and OS prompts.'); };
  shell.openExternal = async () => prohibited(); shell.openPath = async () => prohibited();
  dialog.showOpenDialog = async () => prohibited(); dialog.showMessageBoxSync = prohibited;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) => handle(name,
    name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'Documentation capture' }) :
    ['studio:launch-agent', 'studio:open-setup-assistant', 'studio:resource-install', 'studio:resource-login', 'studio:provider-login', 'studio:connection-login', 'studio:codex-login', 'studio:browser-install-visible', 'studio:computer-permissions', 'studio:computer-settings'].includes(name) ? prohibited :
    name === 'studio:model-catalog' ? () => ({ providers: [], models: [] }) : action);
  const loaded = new Promise((done) => app.once('browser-window-created', (_, value) => {
    value.webContents.setAudioMuted(true);
    value.webContents.once('did-finish-load', () => done(value));
  }));
  const timer = setTimeout(() => app.exit(1), 100000);
  let window;
  try {
    require('./offscreen-main.cjs').loadOffscreenMain();
    window = await loaded; window.setSize(1440, 900);
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => { console.error('Unsaved capture state'); app.exit(1); });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) { if (await js(`Boolean(${code})`)) return; await new Promise(r => setTimeout(r, 35)); }
      throw Error(code + '\n' + await js('document.body.innerText'));
    };
    const saved = () => until(`!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`);
    const click = (name) => js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`);
    await until(`document.documentElement.lang===${JSON.stringify(language)}&&document.documentElement.dataset.theme==='dark'&&document.querySelector('.topbar')`);
    await saved();
    let state = await js('window.studio.loadStudio()');
    assert.deepEqual(state.sections.agentTeams, []); assert.deepEqual(state.sections.agents, []);
    const agents = text.names.map((name, i) => ({ id: randomUUID(), name, enabled: true, mainInstruction: text.prompts[i], instructions: [], skills: [], mcps: [], plugins: [] }));
    const teamId = randomUUID();
    const catalog = { agents, teams: [{ id: teamId, name: text.team, workspaceMode: 'per-agent', agentIds: agents.map(a => a.id) }] };
    await js(`window.studio.saveSection('agentCatalog',${JSON.stringify(catalog)},${JSON.stringify({ folder: state.folder, base: state.sections.agentCatalog })})`);
    let project;
    for (const name of text.projectsList) {
      const result = await js(`window.studio.projectCommand(${JSON.stringify({ kind: 'create', name, teamId, agents })})`);
      project = result.projects.find(p => p.id === result.selectedId); assert.ok(project);
    }
    const projectRoot = join(studio, 'projects', project.folderName);
    for (const [index, filename, content] of [[0, 'audience.md', text.audience], [1, 'offer.md', text.markdown], [1, 'page-structure.md', text.structure]]) {
      const output = join(projectRoot, project.agents[index].outputPath);
      await mkdir(output, { recursive: true }); await writeFile(join(output, filename), content);
    }
    await saved();
    const reloaded = new Promise(r => window.webContents.once('did-finish-load', r)); window.webContents.reload(); await reloaded;
    await until(`document.documentElement.lang===${JSON.stringify(language)}&&document.documentElement.dataset.theme==='dark'&&document.querySelector('.topbar')`);
    await saved();
    const screenshots = [];
    const capture = async (name) => {
      await saved();
      await js(`document.activeElement?.blur(); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      await new Promise(r=>setTimeout(r,180));
      const visible = await js('document.body.innerText');
      assert.ok(!/Город после дождя|Сценарист|Раскадровка|storyboard|Montage|Preview video|БИБЛИОТЕКА/.test(visible));
      assert.equal(await js('document.documentElement.dataset.theme'), 'dark');
      assert.equal(await js('document.documentElement.lang'), language);
      if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
      const frame = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1440, height: 900, scale: 2 },
      });
      const png = Buffer.from(frame.data, 'base64');
      await writeFile(join(root, name + '.png'), png);
      screenshots.push({ name, rawPixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, viewport: { width: 1440, height: 900 }, language, theme: 'dark', topbarHeight: await js(`document.querySelector('.topbar').getBoundingClientRect().height`) });
      console.log(language + ': ' + name);
    };
    await capture('projects');
    await click(text.agents);
    await until(`document.querySelector('.agent-editor')`);
    await js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes(${JSON.stringify(text.names[3])})&&e.classList.contains('agent-list-item')).click()`);
    await until(`document.querySelector('textarea')?.value.includes(${JSON.stringify(language==='en' ? 'Build the landing page' : 'Разработайте лендинг')})`);
    const promptGeometry = [];
    for (const [width, height] of [[1080, 720], [1440, 900]]) {
      window.setSize(width, height);
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const geometry = await js(`(()=>{const field=document.querySelector('.agent-prompt-panel textarea');const footer=document.querySelector('.agent-editor-footer');return {viewport:innerHeight,height:field.getBoundingClientRect().height,bottom:field.getBoundingClientRect().bottom,footerBottom:footer.getBoundingClientRect().bottom,overflow:getComputedStyle(field).overflowY};})()`);
      assert.ok(geometry.bottom <= geometry.viewport - 20, JSON.stringify(geometry));
      assert.ok(geometry.footerBottom <= geometry.viewport - 12, JSON.stringify(geometry));
      assert.equal(geometry.overflow, 'auto');
      promptGeometry.push({ width, ...geometry });
    }
    await until(`Number(document.querySelector('.agent-prompt-panel .textarea-resize-handle').getAttribute('aria-valuemax'))===parseFloat(getComputedStyle(document.querySelector('.agent-prompt-panel textarea')).maxHeight)`);
    const promptLimit = await js(`(()=>{const h=document.querySelector('.agent-prompt-panel .textarea-resize-handle');h.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));return Number(h.getAttribute('aria-valuemax'));})()`);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await js(`document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`), promptLimit);
    const promptBeforeFind = await js(`document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`);
    await js(`document.querySelector('.agent-prompt-panel textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',metaKey:true,bubbles:true}))`);
    await until(`document.querySelector('.agent-prompt-panel .textarea-findbar')`);
    assert.equal(await js(`document.querySelector('.agent-prompt-panel textarea').getBoundingClientRect().height`), promptBeforeFind);
    await js(`document.querySelector('.agent-prompt-panel input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('.main-scroll').scrollTop=0`);
    await until(`!document.querySelector('.agent-prompt-panel .textarea-findbar')`);
    await capture('agents');
    await click(text.projects);
    await js(`Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')?.includes(${JSON.stringify(text.projectsList[2])})).click()`);
    await until(`document.querySelector('.project-agents')||document.querySelector('.project-column-heading')`);
    await js(`Array.from(document.querySelectorAll('button')).find(e=>e.classList.contains('section-menu-item')&&e.textContent.includes(${JSON.stringify(text.names[1])})).click()`);
    await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='offer.md')`);
    await click('offer.md');
    await until(`document.querySelector('.markdown-preview')||document.body.innerText.includes(${JSON.stringify(language==='en' ? 'The offer' : 'Оффер')})`);
    await capture('project');
    state = await js('window.studio.loadStudio()');
    assert.equal(state.projects.length, 3); assert.equal(state.sections.agentTeams.length, 1);
    assert.ok(state.projects.every(p => p.agents.every(a => !a.session)));
    assert.ok(state.projects.every(p => p.sourceTeamId === teamId));
    assert.ok(state.projects.every(p => JSON.stringify(p.agents.map(a => a.profile.id)) === JSON.stringify(agents.map(a => a.id))));
    assert.ok(state.projects.every(p => p.name.endsWith(language === 'en' ? '— landing page' : '— лендинг')));
    assert.equal(forbiddenActions, 0);
    await writeFile(join(root, 'capture.json'), JSON.stringify({ screenshots, forbiddenActions, promptGeometry, sameTeamAndStageOrder: true }));
    await saved(); window.destroy(); clearTimeout(timer); app.quit();
  } catch(error) { clearTimeout(timer); console.error(error); if(window&&!window.isDestroyed())window.destroy(); app.exit(1); }
}
if(process.argv.includes('--child')) child().catch(e=>{console.error(e);require('electron').app.exit(1)});
else parent().catch(e=>{console.error(e);process.exitCode=1});
