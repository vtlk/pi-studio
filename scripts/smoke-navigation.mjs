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
const dragOnly = process.argv.includes('--team-drag');
const root = await mkdtemp(join(tmpdir(), 'pistudio-navigation-'));
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
    Object.assign(agents[0], {
      mainInstruction: 'PROMPT русский',
      instructions: [{ id: 'rule', name: 'Rule', content: 'INSTRUCTION', enabled: false }],
      skills: ['qa-skill'],
      plugins: ['qa-plugin'],
      mcps: ['pistudio-project', 'pistudio-team'],
      capabilitySettings: { 'pistudio-team': { enabled: false } },
      model: {
        connectionId: 'qa-connection',
        provider: 'qa',
        id: 'qa-model',
        reasoning: 'high',
        temperature: '0.5',
      },
    });
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
    const continuationChanges = [];
    window.__qa = { state, calls, continuationChanges };
    window.studio = new Proxy(
      {
        getInfo: async () => ({ platform: 'darwin', version: 'QA', runtimeConnected: true }),
        getLanguage: async () => ({ language, preference: language, revision: 0 }),
        getTheme: async () => ({ theme, preference: theme, revision: 0 }),
        setTheme: async (value) => ({ theme: (theme = value), preference: value, revision: 1 }),
        loadChatDrafts: async ({ folder }) => ({ folder, drafts: [] }),
        saveChatDraft: async ({ revision }) => ({ revision }),
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
        setAutoContinuation: async (request) => {
          continuationChanges.push(clone(request));
          projects.find((project) => project.id === request.projectId).autoContinue =
            request.enabled;
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
  const visit = async (language, theme, studio = 'A') => {
    await cdp('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/?language=${language}&theme=${theme}&studio=${studio}`,
    });
    await until(`!!document.querySelector('.project-list-row')`);
  };
  const checks = [];
  for (const language of ['ru', 'en'])
    for (const theme of ['light', 'dark']) {
      const messages = language === 'ru' ? ru : en;
      await visit(language, theme);
      // Reset only this owned fixture's UI preference; no production userData is used.
      await js(`localStorage.removeItem('pistudio:collapsed-teams:v1:/isolated-navigation-A')`);
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='true'`,
      );
      if (dragOnly) {
        const readCatalog = () => js('window.__qa.state.sections.agentCatalog');
        const original = await readCatalog();
        const button = async (name) => {
          await new Promise((done) => setTimeout(done, 100));
          return js(
            `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent===${JSON.stringify(name)}).click()`,
          );
        };
        const drag = async (source, target, fraction = 0.5) => {
          const center = async (selector, part = 0.5) =>
            js(
              `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+Math.min(100,r.width/2),y:r.y+r.height*${part}};})()`,
            );
          const originalSource = await js(
            `document.querySelector(${JSON.stringify(source)}).getBoundingClientRect().toJSON()`,
          );
          const a = await center(source),
            b = await center(target, fraction);
          await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
          await cdp('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            button: 'left',
            clickCount: 1,
            ...a,
          });
          for (let i = 1; i <= 12; i++) {
            await cdp('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              button: 'left',
              buttons: 1,
              x: a.x + ((b.x - a.x) * i) / 12,
              y: a.y + ((b.y - a.y) * i) / 12,
            });
            await new Promise((done) => setTimeout(done, 25));
          }
          await until(`!!document.querySelector('.agent-drag-preview')`);
          assert.equal(
            await js(`document.querySelectorAll('.agent-list-entry[data-dragging]').length`),
            1,
          );
          const clone = await js(
            `document.querySelector('.agent-drag-preview').getBoundingClientRect().toJSON()`,
          );
          assert.ok(clone.width > 250 && clone.height >= 84);
          const sourceNow = await js(
            `document.querySelector(${JSON.stringify(source)}).getBoundingClientRect().toJSON()`,
          );
          assert.ok(
            Math.abs(sourceNow.x - originalSource.x) < 1 &&
              Math.abs(sourceNow.y - originalSource.y) < 1,
            'Original row stays in place',
          );
          if (fraction !== 0.5) {
            await until(
              `!!document.querySelector('[data-insert-before="true"],.agent-drop-marker')`,
            );
            const marker = await js(
              `(()=>{const el=document.querySelector('[data-insert-before="true"],.agent-drop-marker');return{top:el.getBoundingClientRect().top,team:el.closest('[data-team-id]').dataset.teamId};})()`,
            );
            assert.equal(marker.team, 'team-b');
            assert.ok(
              Math.abs(marker.top - (b.y + (fraction < 0.5 ? -fraction : 1 - fraction) * 84)) < 3,
              'Insertion line matches the chosen row edge',
            );
          }
          if (fraction !== 0.5)
            await cdp('Page.captureScreenshot', { format: 'png' }).then((shot) =>
              writeFile(
                `artifacts/agent-drag-${language}-${theme}.png`,
                Buffer.from(shot.data, 'base64'),
              ),
            );
          await cdp('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            button: 'left',
            clickCount: 1,
            ...b,
          });
          await until(
            `document.querySelector('[role="dialog"] h2')?.textContent===${JSON.stringify(messages['AgentTeamTransfer.title'])}`,
          );
        };
        const sourceA = '[data-team-id="team-a"] .agent-list-item';
        const targetHeader = '[data-team-id="team-b"] .disclosure-heading';
        await click('[data-team-id="team-b"] .disclosure-trigger');
        await drag(sourceA, targetHeader);
        assert.deepEqual(await readCatalog(), original, 'Drop waits for a choice');
        await button(messages['TeamNameDialog.cancel']);
        await until(`!document.querySelector('[role="dialog"]')`);
        assert.deepEqual(await readCatalog(), original, 'Cancel changes nothing');
        await drag(sourceA, targetHeader);
        await button(messages['AgentTeamTransfer.copy']);
        await until(`window.__qa.state.sections.agentCatalog.agents.length===3`);
        const copied = await readCatalog();
        const clone = copied.agents.find((a) => !['a', 'b'].includes(a.id));
        assert.ok(clone);
        assert.deepEqual(clone, { ...original.agents[0], id: clone.id });
        assert.deepEqual(copied.teams[0].agentIds, ['a']);
        assert.deepEqual(copied.teams[1].agentIds, ['b', clone.id]);
        assert.equal(
          await js(
            `document.querySelector('[data-team-id="team-b"] .disclosure-trigger').getAttribute('aria-expanded')`,
          ),
          'true',
        );
        // Drop into the expanded list, directly on an existing agent row.
        await drag(sourceA, '[data-team-id="team-b"] .agent-list-item', 0.75);
        await button(messages['AgentTeamTransfer.move']);
        await until(`window.__qa.state.sections.agentCatalog.teams[0].agentIds.length===0`);
        const moved = await readCatalog();
        assert.deepEqual(
          moved.teams.map((t) => t.agentIds),
          [[], ['b', 'a', clone.id]],
        );
        assert.deepEqual(
          moved.agents.find((a) => a.id === 'a'),
          original.agents[0],
        );
        assert.deepEqual(
          moved.agents.find((a) => a.id === 'b'),
          original.agents[1],
        );
        assert.equal(await js('window.__qa.calls.launch'), 0);
        assert.equal(await js('window.__qa.calls.commands'), 0);
        // Existing within-team reorder remains direct, without the transfer question.
        const rows = await js(
          `Array.from(document.querySelectorAll('[data-team-id="team-b"] .agent-list-item')).map(el=>({id:el.id,rect:el.getBoundingClientRect().toJSON()}))`,
        );
        const a = rows[1].rect,
          b = rows[0].rect;
        const from = { x: a.x + 80, y: a.y + a.height / 2 },
          to = { x: b.x + 80, y: b.y + b.height / 2 };
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
        await cdp('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          ...from,
        });
        for (let i = 1; i <= 12; i++) {
          await cdp('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            button: 'left',
            buttons: 1,
            x: from.x,
            y: from.y + ((to.y - from.y) * i) / 12,
          });
          await new Promise((done) => setTimeout(done, 25));
        }
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          ...to,
        });
        await until(`window.__qa.state.sections.agentCatalog.teams[1].agentIds[0]==='a'`);
        assert.equal(await js(`!!document.querySelector('[role="dialog"]')`), false);
        checks.push({
          language,
          theme,
          actualPointerDrag: true,
          floatingCloneAndStationaryOrigin: true,
          insertionMarkerAndExactMiddlePosition: true,
          collapsedTeamHeaderDrop: true,
          expandedAgentListDrop: true,
          copyPreservesFullSettings: true,
          movePreservesStableId: true,
          cancelLeavesCatalogUnchanged: true,
          sameTeamReorderWithoutDialog: true,
          piOrProjectWorkDispatched: false,
        });
        continue;
      }
      const agentColumnWidth = () =>
        js(`document.querySelector('.agent-stages').getBoundingClientRect().width`);
      const separator = '.agents-workspace .resize-handle';
      const initialWidth = await agentColumnWidth();
      const start = await js(
        `(() => { const r = document.querySelector('${separator}').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + 40}; })()`,
      );
      assert.equal(
        await js(`document.querySelector('${separator}').getAttribute('aria-label')`),
        messages['ProjectView.agentColumnWidth'],
      );
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
      await cdp('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...start,
      });
      await until(`document.querySelector('${separator}').hasAttribute('data-dragging')`);
      const end = { ...start, x: start.x + 100 };
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: 'left',
        buttons: 1,
        ...end,
      });
      await until(
        `document.querySelector('.agent-stages').getBoundingClientRect().width === ${initialWidth + 100}`,
      );
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', ...end });
      assert.equal(await agentColumnWidth(), initialWidth + 100);
      assert.equal(
        await js(
          `document.querySelector('.agents-workspace > .agent-editor').getBoundingClientRect().left === document.querySelector('${separator}').getBoundingClientRect().right`,
        ),
        true,
      );
      await cdp('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Home',
        code: 'Home',
        windowsVirtualKeyCode: 36,
      });
      await until(`document.querySelector('.agent-stages').getBoundingClientRect().width === 200`);
      await click('[data-team-id="team-a"] .disclosure-trigger');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='false'`,
      );
      assert.equal(
        await js(
          `document.querySelector('[data-team-id="team-b"] .disclosure-trigger').getAttribute('aria-expanded')`,
        ),
        'true',
      );
      await click('.topbar nav button:first-child');
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='false'`,
      );
      await visit(language, theme); // Full document reload; the same owned origin/profile retains local storage.
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='false'`,
      );
      await visit(language, theme, 'B');
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='true'`,
      );
      await visit(language, theme, 'A');
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='false'`,
      );
      await click('[data-team-id="team-a"] .disclosure-trigger');
      await visit(language, theme);
      await click('.topbar nav button:nth-child(2)');
      await until(
        `document.querySelector('[data-team-id="team-a"] .disclosure-trigger')?.getAttribute('aria-expanded')==='true'`,
      );
      await click('.topbar nav button:first-child');
      // Choose the second project by name rather than relying on date sorting.
      await js(
        `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('Project b')).click()`,
      );
      await until(`document.querySelector('.project-header h1')?.textContent==='Project b'`);
      const continuationSwitch = '.project-agent-heading [role="switch"]';
      await click(continuationSwitch);
      await until(
        `document.querySelector('${continuationSwitch}')?.getAttribute('aria-checked')==='true'`,
      );
      await click('.topbar nav button:nth-child(2)');
      await click('.topbar nav button:first-child');
      await until(
        `document.querySelector('${continuationSwitch}')?.getAttribute('aria-checked')==='true'`,
      );
      await click(continuationSwitch);
      await until(
        `document.querySelector('${continuationSwitch}')?.getAttribute('aria-checked')==='false'`,
      );
      assert.deepEqual(await js('window.__qa.continuationChanges'), [
        { projectId: 'project-b', agentId: 'b', enabled: true },
        { projectId: 'project-b', agentId: 'b', enabled: false },
      ]);
      assert.equal(await js('window.__qa.calls.launch'), 0);
      await click('.topbar nav button:first-child');
      assert.equal(
        await js(`document.querySelector('.project-header h1')?.textContent`),
        'Project b',
      );
      await click('.topbar nav button:nth-child(2)');
      await click('.topbar nav button:first-child');
      await until(`document.querySelector('.project-header h1')?.textContent==='Project b'`);
      await click('.topbar .settings-button');
      await click('.topbar nav button:first-child');
      await until(`document.querySelector('.project-header h1')?.textContent==='Project b'`);
      assert.equal(
        await js(`document.querySelector('.project-back').getAttribute('aria-label')`),
        messages['ProjectView.backToProjects'],
      );
      assert.equal(
        await js(`!!document.querySelector('.project-back .lucide-chevron-left')`),
        true,
      );
      await click('.project-header-actions .button');
      await until(
        `document.querySelector('[role="dialog"] h2')?.textContent===${JSON.stringify(messages['ProjectView.refreshAgents2'])}`,
      );
      assert.equal(
        await js(`document.querySelector('.project-header h1')?.textContent`),
        'Project b',
      );
      await js(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent===${JSON.stringify(messages['TeamNameDialog.cancel'])}).click()`,
      );
      await until(`!document.querySelector('[role="dialog"]')`);
      // Hover on blank header padding: it is part of the back target, never part of Refresh.
      const point = await js(
        `(()=>{const r=document.querySelector('.project-header').getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()`,
      );
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      assert.equal(
        await js(
          `(()=>{const s=getComputedStyle(document.querySelector('.project-header'));return s.backgroundColor!==${JSON.stringify('rgb(0, 0, 0)')};})()`,
        ),
        true,
      );
      assert.equal(
        await js(`getComputedStyle(document.querySelector('.project-header')).borderBottomWidth`),
        '1px',
      );
      assert.equal(
        await js(`getComputedStyle(document.querySelector('.project-back')).backgroundColor`),
        'rgba(0, 0, 0, 0)',
      );
      assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`), true);
      await mkdir('artifacts', { recursive: true });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1090, y: 20 });
      assert.equal(
        await js(
          `(()=>{const s=getComputedStyle(document.querySelector('.project-header'));return s.backgroundColor===${JSON.stringify('rgb(0, 0, 0)')};})()`,
        ),
        true,
      );
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(
        `artifacts/navigation-${language}-${theme}.png`,
        Buffer.from(screenshot.data, 'base64'),
      );
      const headerImage = await cdp('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 1100, height: 245, scale: 1 },
      });
      await writeFile(
        `artifacts/navigation-header-${language}-${theme}.png`,
        Buffer.from(headerImage.data, 'base64'),
      );
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await cdp('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await until(`!!document.querySelector('.project-list-row')`);
      await click('.topbar nav button:nth-child(2)');
      await click('.topbar nav button:first-child');
      await until(`!!document.querySelector('.project-list-row')`);
      assert.equal(
        await js(`!!document.querySelector('.project-header')`),
        false,
        'Explicit Back remembers the list',
      );
      await js(
        `Array.from(document.querySelectorAll('.project-list-row')).find(button=>button.textContent.includes('Project a')).click()`,
      );
      await until(`document.querySelector('.project-header h1')?.textContent==='Project a'`);
      await js(`document.querySelector('.project-back').focus()`);
      await until(`document.activeElement===document.querySelector('.project-back')`);
      await cdp('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await cdp('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await until(`!!document.querySelector('.project-list-row')`);
      assert.deepEqual(await js('window.__qa.calls'), { launch: 0, commands: 0, saves: 0 });
      checks.push({
        language,
        theme,
        collapsedAndExpandedTeamsPersistAcrossNavigationAndReload: true,
        studioIsolation: true,
        exactProjectRemembered: true,
        explicitBackRemembersList: true,
        refreshDoesNotNavigateOrMutate: true,
        headerPaddingAndKeyboardBack: true,
        continuationSwitchTargetsSelectedAgentWithoutLaunching: true,
        agentListWidthChangesWithPointerAndKeyboard: true,
        hoverAndNoHorizontalOverflow: true,
        chevronLeftIconAndFullWidthBottomBorder: true,
        blackHeaderInBothThemes: true,
      });
    }
  assert.deepEqual(errors, []);
  const proof = {
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    checkedAt: new Date().toISOString(),
    checks,
    scope:
      'Production compiled renderer in an isolated pinned headless shell with mock native APIs; not native platform acceptance',
    userAppOrDataChanged: false,
    realPiLaunches: 0,
  };
  await writeFile(
    dragOnly ? 'artifacts/agent-team-drag-proof.json' : 'artifacts/navigation-ui-proof.json',
    JSON.stringify(proof, null, 2) + '\n',
  );
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
