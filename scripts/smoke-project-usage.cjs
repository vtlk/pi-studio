const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = require('node:fs');
const { rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root, win, current;
const timeout = setTimeout(() => fail(Error('Project usage UI timed out')), 35000);
async function cleanup() {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (root) await rm(root, { recursive: true, force: true });
}
async function fail(error) { console.error(error); await cleanup(); app.exit(1); }
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-project-usage-ui-')));
  const studio = join(root, 'Studio'), userData = join(root, 'UserData');
  mkdirSync(userData); mkdirSync(join(studio, '.pistudio'), { recursive: true });
  app.setPath('userData', userData); app.setPath('videos', root);
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const profile = { id: 'agent', name: 'Сценарист', enabled: true, skills: [], mcps: [], plugins: [], instructions: [], model: { connectionId: 'qa', provider: 'openai-codex', id: 'fixture', reasoning: 'low', temperature: '' } };
  const second = { ...profile, id: 'second', name: 'Очень длинное название для проверки полного имени агента при обрезании', model: undefined };
  writeFileSync(join(studio, '.pistudio/studio.json'), JSON.stringify({ schemaVersion: 1, sections: { agents: [profile, second], connections: [{ id: 'qa', name: 'Fixture', purpose: 'codex', providerId: 'openai-codex', endpoint: '', account: '', createdAt: 1 }] } }));
  const folder = join(studio, 'projects/usage-project');
  for (const id of ['agent', 'second']) mkdirSync(join(folder, `agents/${id}/output`), { recursive: true });
  writeFileSync(join(folder, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'usage-project', name: 'Расход проекта', createdAt: 1, agents: [profile, second].map(({ instructions, ...profile }) => ({ profile, outputPath: `agents/${profile.id}/output` })) }));
  const measure = sum => ({ sum, known: 1, unknown: 0 });
  const tokens = { input: measure(1700), output: measure(320), cacheRead: measure(900), cacheWrite: measure(100), total: measure(3020) };
  mkdirSync(join(folder, '.pistudio'));
  writeFileSync(join(folder, '.pistudio/usage.json'), JSON.stringify({ schemaVersion: 1, projectId: 'usage-project', legacy: false, agents: { agent: { legacy: false, seen: ['a'.repeat(32)], duration: measure(754000), tokens, costs: { USD: { sum: .04, estimated: true } }, unknownCost: 0 }, second: { legacy: false, seen: [], duration: measure(0), tokens: Object.fromEntries(Object.keys(tokens).map(key => [key, measure(0)])), costs: {}, unknownCost: 0 } } }));
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) => handle(name,
    name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) :
    name === 'studio:model-catalog' ? () => ({ providers: [], models: [] }) :
    name === 'studio:list-project-usage' ? async event => {
      const saved = await action(event);
      assert.equal(saved[0].total.tokens.input.value, 1700, 'Actual main handler loads the persisted aggregate.');
      return current ?? saved;
    } : action);
  global.fetch = async () => { throw Error('No network/model requests in usage UI QA'); };
  const loaded = new Promise(done => app.once('browser-window-created', (_, window) => {
    window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => done(window));
  }));
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  win = await loaded;
  const js = code => win.webContents.executeJavaScript(code, true);
  const until = async code => {
    for (let i = 0; i < 150; i++) { if (await js(code)) return; await new Promise(done => setTimeout(done, 30)); }
    throw Error('Timed out: ' + code);
  };
  await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});true`);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until(`document.querySelector('.project-spent')?.textContent.includes('1.7k')`);
  assert.equal(await js(`document.querySelectorAll('th')[1].textContent`), 'Потрачено');
  assert.equal(await js(`document.querySelector('.project-list-folder').textContent`), '12:34 · usage-project');
  assert.match(await js(`document.querySelector('.project-list-folder').getAttribute('aria-label')`), /754 секунд/);
  assert.match(await js(`document.querySelector('.project-spent').textContent`), /1.7k.*320.*\$0.04/);
  await writeFile('artifacts/project-usage-list-ui.png', (await win.capturePage()).toPNG());
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`document.querySelectorAll('.project-agent-menu .section-menu-item').length===2`);
  const row = `.project-agent-menu .section-menu-row:first-child`;
  assert.equal(await js(`Math.round(document.querySelector('${row} .section-menu-icon-anchor').getBoundingClientRect().width)`), 32, 'The tooltip anchor never expands the status icon column.');
  assert.match(await js(`document.querySelector('${row} .section-menu-description').textContent`), /12:34.*1.7k.*320.*\$0.04/);
  assert.doesNotMatch(await js(`document.querySelector('${row} .section-menu-description').textContent`), /Не запускался/);
  assert.equal(await js(`document.querySelectorAll('.project-agent-menu .section-menu-row:nth-child(2) button[aria-label="Запустить"]').length`), 0);
  assert.equal(await js(`document.querySelectorAll('${row} button[aria-label="Запустить"]').length`), 1);
  assert.match(await js(`document.querySelector('${row} button').getAttribute('aria-label')`), /Не запускался.*Входные токены: 1700.*Выходные токены: 320/);
  const hover = async selector => {
    await js(`(()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); const previous=window.__hover; if(previous)previous.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:document.body}));window.__hover=null;})()`);
    await until(`!document.querySelector('[role="tooltip"]')`);
    await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); window.__hover=el;const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  await hover(`${row} .section-menu-icon-anchor`);
  assert.equal(await js(`document.querySelector('[role="tooltip"]')?.textContent`), 'Не запускался', 'Status tooltip opens without a timed hover delay.');
  await hover('.project-column-heading');
  await js(`document.querySelector('${row} .section-menu-item').focus()`);
  await until(`document.querySelector('[role="tooltip"]')?.textContent==='Не запускался'`);
  await js(`document.querySelector('${row} .section-menu-item').blur(); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  current = await js(`window.studio.listProjectUsage()`);
  const updated = current[0];
  for (const state of [updated.total, updated.agents.agent]) {
    state.duration.value = 755000; state.tokens.input.value = 999950; state.tokens.output = { value: null, partial: true };
    state.costs[0].value = .0000001; state.costPartial = true;
  }
  await until(`document.querySelector('${row} .section-menu-description').textContent.includes('12:35')`);
  assert.match(await js(`document.querySelector('${row} .section-menu-description').textContent`), /1m.*—.*<\$0.0001/);
  assert.equal(await js(`document.activeElement===document.body`), true, 'Polling never steals keyboard focus.');
  await writeFile('artifacts/project-usage-agents-ui.png', (await win.capturePage()).toPNG());
  assert.equal(win.isVisible(), false); assert.equal(win.webContents.isOffscreen(), true);
  await writeFile('artifacts/project-usage-ui-proof.json', JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Actual native renderer/preload/main persisted usage, then isolated incremental usage fixture; runtime producer verified separately', persistedUsage: true, projectAndAgentMetrics: true, inputOutputSeparated: true, statusOnlyOnIcon: true, immediateHover: true, keyboardStatus: true, missingModelKeepsLaunchHidden: true, unknownPartialAndTinyCost: true, pollUpdatesWithoutFocusChange: true, noModelOrNetwork: true, offscreen: true }, null, 2) + '\n');
  console.log('Project usage UI passed: persisted totals, project/agent metrics, instant status hover/keyboard, partial/unknown values and live polling without focus changes.');
  await cleanup(); app.exit(0);
})().catch(fail);
