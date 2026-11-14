const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { mkdtempSync, mkdirSync, realpathSync, writeFileSync } = require('node:fs');
const { readFile, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
let root,
  win,
  server,
  confirmations = 0,
  willQuit = 0;
const children = [],
  streams = [];
const originalExec = childProcess.execFile,
  nativeExec = promisify(originalExec);
const timeout = setTimeout(() => fail(Error('Quit cancellation QA timed out')), 90000);
async function cleanup() {
  clearTimeout(timeout);
  childProcess.execFile = originalExec;
  for (const child of children) if (child.process.exitCode === null) child.process.kill('SIGKILL');
  await Promise.all(children.map((child) => child.exited));
  for (const stream of streams) if (!stream.response.writableEnded) stream.response.end();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  app.setActivationPolicy('accessory');
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-quit-cancel-')));
  const userData = join(root, 'UserData'),
    studio = join(root, 'Studio');
  for (const path of [userData, studio, join(root, 'NativePi')]) mkdirSync(path);
  app.setPath('userData', userData);
  app.setPath('videos', root);
  process.env.PI_CODING_AGENT_DIR = join(root, 'NativePi');
  process.env.PI_OFFLINE = '1';
  process.env.PI_TELEMETRY = '0';
  // Register the real main's protocol before yielding to Electron's ready event.
  const piPath =
    process.env.PI_STUDIO_QA_PI ||
    childProcess.execFileSync('/usr/bin/which', ['pi'], { encoding: 'utf8' }).trim();
  const piVersion = childProcess.execFileSync(piPath, ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(piVersion, '1.5.2');
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  mkdirSync(join(studio, '.pistudio'));
  writeFileSync(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        piPath,
      },
    }),
  );
  // Hold a real native SDK stream while cancelling the actual Electron quit lifecycle.
  server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, undefined);
      assert.equal(body.model, 'qa-quit');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ id: 'qa-quit', object: 'chat.completion.chunk', created: 1, model: 'qa-quit', choices: [{ index: 0, delta: { role: 'assistant', content: 'Working' }, finish_reason: null }] })}\n\n`,
      );
      const stream = { response, closed: false };
      response.once('close', () => {
        stream.closed = true;
      });
      streams.push(stream);
    } catch (error) {
      void fail(error);
    }
  });
  const listening = new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Replace only Terminal launching. Native main/context/transport/SDK remain real.
  const interceptTerminal = async (file, args, options) => {
    if (file !== '/usr/bin/osascript') return nativeExec(file, args, options);
    const match = args.at(-1).match(/exec '([^']+)' '([^']+)' '([^']+)'$/);
    assert.ok(match, 'Only the known session command may be intercepted');
    const [, node, bridge, bootstrap] = match;
    assert.ok(node.endsWith('/node'));
    assert.ok(bridge.endsWith('/bundled/pi-bridge/session.mjs'));
    assert.ok(bootstrap.startsWith(join(userData, 'session-bootstraps') + '/'));
    const data = JSON.parse(await readFile(bootstrap, 'utf8'));
    await writeFile(bootstrap, JSON.stringify({ ...data, headless: true }));
    const process = childProcess.spawn(node, [bridge, bootstrap], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...global.process.env },
    });
    const child = { process, errors: '', exited: null };
    process.stderr.on('data', (bytes) => {
      child.errors += bytes.toString();
    });
    child.exited = new Promise((r) => process.once('exit', (code, signal) => r({ code, signal })));
    children.push(child);
    return { stdout: '', stderr: '' };
  };
  const patchedExec = function (file, ...args) {
    if (file === '/usr/bin/osascript') throw Error('Unexpected raw Terminal launch');
    return originalExec(file, ...args);
  };
  patchedExec[promisify.custom] = interceptTerminal;
  childProcess.execFile = patchedExec;
  dialog.showMessageBoxSync = (_window, options) => {
    assert.equal(options.message, 'Изменения ещё не сохранены');
    confirmations++;
    return 0; // Stay. No native dialog appears on the user's desktop.
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action);
  const loaded = new Promise((r) =>
    app.once('browser-window-created', (_, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => r(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  win = await loaded;
  await listening;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (condition) => {
    for (let i = 0; i < 300; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Quit QA condition timed out');
  };
  await until(() => js(`!!document.querySelector('[aria-label="Создать проект"]')`));
  const save = async (key, value) => {
    const before = await js('window.studio.loadStudio()');
    const result = await js(
      `window.studio.saveSection(${JSON.stringify(key)},${JSON.stringify(value)},${JSON.stringify({ folder: before.folder, base: before.sections[key] })})`,
    );
    assert.equal(result.saved, true);
  };
  const connection = {
    id: 'qa-quit',
    name: 'Quit local fixture',
    purpose: 'local',
    providerId: 'studio-qa-quit',
    authScope: 'connection',
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    account: '',
    createdAt: 1,
    endpointConfig: {
      api: 'openai-completions',
      auth: 'none',
      models: [
        {
          id: 'qa-quit',
          name: 'Quit model',
          reasoning: false,
          imageInput: false,
          contextWindow: 8192,
          maxTokens: 512,
        },
      ],
    },
  };
  const agent = {
    id: 'qa-agent',
    name: 'Quit agent',
    enabled: true,
    mainInstruction: 'Answer the local fixture.',
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      connectionId: connection.id,
      provider: connection.providerId,
      id: 'qa-quit',
      reasoning: 'По умолчанию',
      temperature: '',
    },
  };
  await save('connections', [connection]);
  await save('agents', [agent]);
  const created = await js(
    `window.studio.projectCommand({kind:'create',name:'Quit check',agents:[]})`,
  );
  const projectId = created.selectedId;
  const launch = (request) =>
    js(
      `window.studio.launchAgent(${JSON.stringify({ projectId, agentId: agent.id, autoContinue: false, ...request })})`,
    );
  const launched = await launch({ firstMessage: 'Hold this request for the quit fixture.' });
  const binding = launched.project.agents[0].session;
  assert.ok(binding);
  await until(() => streams.length === 1);
  console.log('Native Pi request is live; cancelling Quit.');
  await js(
    `window.__qaPreventClose = event => {event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',window.__qaPreventClose)`,
  );
  app.on('will-quit', (event) => {
    event.preventDefault();
    willQuit++;
  });
  app.quit();
  await until(() => confirmations === 1);
  assert.equal(win.isDestroyed(), false);
  assert.equal(willQuit, 0);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(streams[0].closed, false, 'Stay must not abort the admitted native request');
  streams[0].response.write(
    `data: ${JSON.stringify({ id: 'qa-quit', object: 'chat.completion.chunk', created: 1, model: 'qa-quit', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
  );
  streams[0].response.end('data: [DONE]\n\n');
  const firstExit = await children[0].exited;
  assert.equal(firstExit.code, 0, children[0].errors);
  await until(
    async () =>
      (await js(`window.studio.readProject(${JSON.stringify(projectId)})`)).agents[0].runStatus ===
      'stopped',
  );
  const state = await js(`window.studio.readProject(${JSON.stringify(projectId)})`);
  assert.deepEqual(state.agents[0].session, binding);
  const projectRoot = join(studio, 'projects', state.folderName);
  const transcript = await readFile(join(projectRoot, binding.path), 'utf8');
  await launch({});
  assert.equal((await children[1].exited).code, 0, children[1].errors);
  assert.equal(streams.length, 1, 'Idle resume must not replay the request after cancelled Quit');
  assert.equal(await readFile(join(projectRoot, binding.path), 'utf8'), transcript);
  const finalProject = await js(
    `window.studio.projectCommand({kind:'create',name:'Final quit',agents:[]})`,
  );
  await launch({
    projectId: finalProject.selectedId,
    firstMessage: 'Hold until the confirmed exit.',
  });
  await until(() => streams.length === 2);
  await js(`window.removeEventListener('beforeunload',window.__qaPreventClose)`);
  app.quit();
  await until(() => willQuit === 1);
  await until(() => streams[1].closed);
  await until(
    () => children[2].process.exitCode !== null || children[2].process.signalCode !== null,
  );
  assert.equal(win.isDestroyed(), true);
  const sources = [
    'src/main/ipc/registerDesktopHandlers.ts',
    'src/main/windows/createStudioWindow.ts',
    'scripts/smoke-quit-cancel.cjs',
  ];
  const proof = {
    sourceVersion: require('../package.json').version,
    electronVersion: process.versions.electron,
    piVersion,
    beforeFix:
      'Actual cancelled app.quit destroyed the live native request: expected stream.closed=false, got true.',
    passed: {
      cancelledQuitKeepsWindowAndRequest: true,
      cancelledQuitDoesNotEmitWillQuit: true,
      nativeResponsePersistsAndUpdatesStatus: true,
      exactBindingAndTranscriptOnIdleResume: true,
      idleResumeDoesNotReplay: true,
      confirmedQuitClosesWindowRequestAndChild: true,
    },
    modelRequests: streams.length,
    limits:
      'Actual production main/preload/Electron quit lifecycle and native Pi SDK. Only OS confirmation and Terminal dispatch intercepted; model SSE is loopback, no cloud requests or user studio access. Unsaved state supplied by a test renderer beforeunload guard.',
    sourceSha256: Object.fromEntries(
      await Promise.all(
        sources.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(__dirname, '..', path)))
            .digest('hex'),
        ]),
      ),
    ),
  };
  await writeFile(
    join(__dirname, '../artifacts/quit-cancellation-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    'Quit lifecycle passed: Stay preserves the active native request/channel; completion and exact idle resume work; confirmed quit closes the active native stream. Dialog/Terminal intercepted; all model HTTP local.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
