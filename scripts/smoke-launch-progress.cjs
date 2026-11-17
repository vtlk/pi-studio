const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-launch-progress-')));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, '--child', root], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code) reject(Error(output));
        else resolve();
      });
    });
    const proof = await readFile(join(root, 'proof.json'), 'utf8');
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/launch-progress-proof.json', proof);
    await require('node:fs/promises').copyFile(
      join(root, 'project-inline-settings.png'),
      'artifacts/project-inline-settings.png',
    );
    console.log(proof);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function child() {
  const { app, ipcMain } = require('electron');
  const root = process.argv[3];
  const folder = join(root, 'Studio');
  const userData = join(root, 'UserData');
  require('node:fs').mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  require('./offscreen-main.cjs').configureQaRuntime();
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder }));
  const connection = {
    id: 'qa-account',
    name: 'QA',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  const model = {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'qa-model',
    reasoning: 'Средний',
    temperature: '',
  };
  const agents = ['bound-a', 'bound-b', 'fresh', 'fresh-chain', 'unconfigured'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    ...(id === 'unconfigured' ? {} : { model }),
  }));
  const project = {
    schemaVersion: 1,
    id: 'progress-project',
    name: 'Launch progress',
    createdAt: 1,
    sourceTeamId: 'qa-team',
    agents: agents.map(({ instructions, ...profile }) => ({
      profile,
      outputPath: `agents/${profile.id}/output`,
      ...(profile.id.startsWith('bound')
        ? {
            session: {
              id: profile.id,
              title: profile.name,
              path: `agents/${profile.id}/sessions/exact.jsonl`,
              createdAt: 1,
            },
          }
        : {}),
    })),
  };
  const projectRoot = join(folder, 'projects', 'launch-progress');
  const projectFile = join(projectRoot, 'project.json');
  const originals = [];
  for (const agent of project.agents) {
    mkdirSync(join(projectRoot, agent.outputPath), { recursive: true });
    writeFileSync(
      join(projectRoot, agent.outputPath, 'result.md'),
      '# Result for ' + agent.profile.id,
    );
    mkdirSync(join(projectRoot, `agents/${agent.profile.id}/sessions`), { recursive: true });
    if (agent.session) {
      const content = JSON.stringify({ type: 'session', id: agent.profile.id }) + '\n';
      writeFileSync(join(projectRoot, agent.session.path), content);
      originals.push([agent.profile.id, content]);
    }
  }
  writeFileSync(projectFile, JSON.stringify(project));
  mkdirSync(join(folder, '.pistudio'));
  writeFileSync(
    join(folder, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents,
        agentTeams: [
          { id: 'qa-team', name: 'QA', agentIds: agents.map((a) => a.id), createdAt: 1 },
        ],
        connections: [connection],
      },
    }),
  );
  let projectLocalSessions = false;
  const requests = [];
  const reveals = [];
  const commands = [];
  const pending = new Map();
  const fixtureSessions = new Map();
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
        : channel === 'studio:connection-status'
          ? () => ({
              connectionId: connection.id,
              provider: connection.providerId,
              status: 'ready',
            })
          : channel === 'studio:reveal-agent-output'
            ? (_, request) => {
                reveals.push(request);
              }
            : channel === 'studio:project-command'
              ? (...args) => {
                  commands.push(args[1]);
                  return action(...args);
                }
              : channel === 'studio:read-project'
                ? async (...args) => {
                    const indexed = await action(...args);
                    return {
                      ...indexed,
                      agents: indexed.agents.map((agent) =>
                        fixtureSessions.has(agent.profile.id)
                          ? { ...agent, session: fixtureSessions.get(agent.profile.id) }
                          : agent,
                      ),
                    };
                  }
                : channel === 'studio:launch-agent'
                  ? (_, request) => {
                      requests.push(request);
                      assert.ok(!pending.has(request.agentId), 'No duplicate launch IPC');
                      return new Promise((resolve, reject) =>
                        pending.set(request.agentId, { resolve, reject }),
                      );
                    }
                  : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, w) => {
      w.webContents.setAudioMuted(true);
      w.webContents.once('did-finish-load', () => resolve(w));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const w = await loaded;
  w.webContents.on('will-prevent-unload', () => {
    throw Error('Unsaved QA state');
  });
  w.webContents.debugger.attach('1.3');
  await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const js = (code) =>
    w.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Progress QA expression:', code);
      throw error;
    });
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error(code + '\n' + (await js('document.body.innerText.slice(-2000)')));
  };
  const row = (id) =>
    `Array.from(document.querySelectorAll('.project-agent-menu .section-menu-row')).find(r=>r.querySelector('.section-menu-label')?.textContent.endsWith(${JSON.stringify('. ' + id)}))`;
  const toolbar = (id) => `${row(id)}.querySelector('.project-agent-actions')`;
  const main = (id) => `${toolbar(id)}.querySelector('.project-agent-launch')`;
  const busy = (id) => `${toolbar(id)}.getAttribute('aria-busy')==='true'`;
  const saved = () =>
    until(
      `!!document.querySelector('[data-save-state="idle"]')&&!document.querySelector('.storage-error')`,
    );
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const settle = async (id, failure) => {
    const call = pending.get(id);
    assert.ok(call, 'Launch must reach held IPC');
    pending.delete(id);
    if (failure) call.reject(Error('QA delayed opening failure'));
    else {
      const result = JSON.parse(await readFile(projectFile, 'utf8'));
      const agent = result.agents.find((a) => a.profile.id === id);
      if (!agent.session) {
        agent.session = {
          id,
          title: id,
          path: projectLocalSessions
            ? `.pistudio/sessions/${id}/exact.jsonl`
            : `agents/${id}/sessions/exact.jsonl`,
          createdAt: 1,
        };
        await mkdir(require('node:path').dirname(join(projectRoot, agent.session.path)), {
          recursive: true,
        });
        await writeFile(
          join(projectRoot, agent.session.path),
          JSON.stringify({ type: 'session', id }) + '\n',
        );
        await writeFile(projectFile, JSON.stringify(result));
      }
      fixtureSessions.set(id, agent.session);
      const indexed = await js(`window.studio.readProject('progress-project')`);
      call.resolve({ runId: 'qa-' + id, project: indexed });
    }
    await until(`!(${busy(id)})`);
  };
  const checkBusy = async (id) => {
    await until(busy(id));
    const dimensions = await js(
      `(()=>{const s=${toolbar(id)},b=s.querySelector('.project-agent-launch'),r=b.getBoundingClientRect();return {disabled:[...s.querySelectorAll('button')].every(b=>b.disabled),spinner:!!b.querySelector('.project-launch-spinner'),animation:getComputedStyle(b.querySelector('svg')).animationName,width:r.width,height:r.height}})()`,
    );
    assert.equal(dimensions.disabled, true);
    assert.equal(dimensions.spinner, true);
    assert.equal(dimensions.animation, 'agent-status-spin');
    return dimensions;
  };
  const menu = async (id) => {
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const trigger = `${toolbar(id)}.querySelector('.project-agent-menu-trigger')`;
    await until(`!${trigger}.disabled&&${trigger}.getAttribute('aria-expanded')!=='true'`);
    await js(`${trigger}.focus()`);
    await until(`document.activeElement===${trigger}`);
    await js(
      `${trigger}.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`,
    );
    await until(`!!document.querySelector('[role="menu"][data-state="open"] [role="menuitem"]')`);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  const auto = async (id) => {
    await menu(id);
    await js(`document.querySelector('[role="menuitem"]').click()`);
  };
  const message = async (value) =>
    js(
      `(()=>{const t=document.querySelector('.agent-first-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(value)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(`!!document.querySelector('[aria-label="Открыть проект «Launch progress»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Launch progress»"]').click()`);
  await until(`!!(${row('bound-a')})`);
  projectLocalSessions = (await js("window.studio.readProject('progress-project')")).agents
    .find((a) => a.profile.id === 'bound-a')
    .session.path.startsWith('.pistudio/sessions/');
  const menuChecks = await require('./project-agent-menu-checks.cjs')({
    root,
    js,
    until,
    click,
    row,
    main,
    menu,
    w,
    requests,
    reveals,
    commands,
  });
  const originalSize = await js(
    `(()=>{const r=${main('bound-a')}.getBoundingClientRect();return {width:r.width,height:r.height}})()`,
  );
  await js(`(()=>{const b=${main('bound-a')};b.click();b.click()})()`);
  const dimensions = await checkBusy('bound-a');
  assert.equal(dimensions.width, originalSize.width);
  assert.equal(dimensions.height, originalSize.height);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].firstMessage, undefined);
  assert.equal(await js(`${main('bound-b')}.disabled`), false);
  await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  assert.equal(
    await js(`getComputedStyle(${main('bound-a')}.querySelector('svg')).animationName`),
    'none',
  );
  await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  await js(`${main('bound-b')}.click()`);
  await checkBusy('bound-b');
  await settle('bound-a');
  assert.equal(await js(busy('bound-b')), true);
  assert.equal(await js(`!!${main('bound-a')}.querySelector('.lucide-message-square')`), true);
  await settle('bound-b', true);
  assert.equal(await js(`${main('bound-b')}.disabled`), false);
  await until(`document.body.innerText.includes('QA delayed opening failure')`);
  const beforeCancel = requests.length;
  await menu('bound-b');
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(`!document.querySelector('[role="menuitem"]')`);
  assert.equal(await js(busy('bound-b')), false);
  assert.equal(requests.length, beforeCancel);
  await auto('bound-b');
  await checkBusy('bound-b');
  assert.equal(requests.at(-1).autoContinue, true);
  assert.equal(requests.at(-1).firstMessage, undefined);
  await settle('bound-b');
  const mode = `document.querySelector('.project-agent-heading [role="switch"]')`;
  const countBeforeMode = requests.length;
  await js(`${mode}.click()`);
  await until(`${mode}.getAttribute('aria-checked')==='true'`);
  assert.equal(requests.length, countBeforeMode);
  await js(`${main('bound-b')}.click()`);
  await checkBusy('bound-b');
  assert.equal(requests.at(-1).autoContinue, true);
  assert.equal(requests.at(-1).firstMessage, undefined);
  await js(`${mode}.click()`);
  assert.equal(
    requests.at(-1).autoContinue,
    true,
    'Changing the preference cannot rewrite an admitted launch',
  );
  await settle('bound-b');
  await js(`${main('fresh')}.click()`);
  await until(`!!document.querySelector('.agent-first-message')`);
  assert.equal(await js(busy('fresh')), false);
  await click('Отмена');
  await until(`!document.querySelector('.agent-first-message')`);
  assert.equal(requests.length, 4);
  await js(`${main('unconfigured')}.click()`);
  await until(
    `document.querySelector('[role="dialog"]')?.textContent.includes('Сначала настройте')`,
  );
  assert.equal(await js(busy('unconfigured')), false);
  await js(`document.querySelector('[role="dialog"] footer button').click()`);
  await until(`!document.querySelector('[role="dialog"]')`);
  for (const id of ['fresh', 'fresh-chain']) {
    if (id === 'fresh-chain') {
      await js(`${mode}.click()`);
      await until(`${mode}.getAttribute('aria-checked')==='true'`);
    }
    await js(`${main(id)}.click()`);
    await until(`!!document.querySelector('.agent-first-message')`);
    await message('First exact task: ' + id);
    const submit = id === 'fresh' ? 'Запустить' : 'Запустить и продолжить';
    await click(submit);
    await checkBusy(id);
    assert.equal(requests.at(-1).autoContinue, id === 'fresh-chain');
    assert.equal(requests.at(-1).firstMessage, 'First exact task: ' + id);
    if (id === 'fresh') {
      await settle(id, true);
      assert.equal(
        await js(`document.querySelector('.agent-first-message').value`),
        'First exact task: ' + id,
      );
      await click(submit);
      await checkBusy(id);
    }
    await settle(id);
    await until(`!document.querySelector('.agent-first-message')`);
    if (id === 'fresh-chain') {
      assert.equal(await js(`!!${main(id)}.querySelector('.lucide-list-start')`), true);
      await js(`${mode}.click()`);
    }
    assert.equal(await js(`!!${main(id)}.querySelector('.lucide-message-square')`), true);
  }
  assert.equal(requests.length, 7);
  assert.equal(pending.size, 0);
  const finalProject = await js("window.studio.readProject('progress-project')");
  for (const [id, content] of originals) {
    const session = finalProject.agents.find((agent) => agent.profile.id === id).session;
    assert.equal(session.id, id);
    assert.equal(await readFile(join(projectRoot, session.path), 'utf8'), content);
  }
  await saved();
  await writeFile(
    join(root, 'proof.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        nativeMainPreloadRenderer: true,
        ...menuChecks,
        launchRequests: requests.length,
        synchronousDoubleClickDispatchesOnce: true,
        perAgentParallelProgress: true,
        successAndFailureRestoreIcons: true,
        newAndResumeAutoContinue: true,
        headerPreferenceAppliedOnlyAtExplicitLaunch: true,
        draftPreservedOnFailure: true,
        cancelAndMissingConfigurationDoNotSpinOrDispatch: true,
        reducedMotion: true,
        dimensionsPreserved: originalSize,
        canonicalHistoryUnchanged: true,
        realTerminalOrModelStarted: false,
        userAppOrDataChanged: false,
        limits:
          'Isolated compiled native UI; launch IPC is held/resolved/rejected explicitly. Real Terminal timing/platform acceptance remains separate.',
      },
      null,
      2,
    ) + '\n',
  );
  w.destroy();
  app.exit(0);
}

(process.argv.includes('--child') ? child() : parent()).catch((error) => {
  console.error(error);
  if (process.argv.includes('--child')) require('electron').app.exit(1);
  else process.exitCode = 1;
});
