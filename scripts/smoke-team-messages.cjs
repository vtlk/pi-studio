const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { readFile, rm, mkdir, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const timeout = setTimeout(() => { console.error('Team queue UI timed out'); app.exit(1); }, 45000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-team-queue-ui-'));
  const userData = join(root, 'UserData'), studio = join(root, 'Studio'), directory = join(studio, 'projects/project');
  mkdirSync(userData); mkdirSync(join(studio, '.pistudio'), { recursive: true });
  writeFileSync(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  const agents = ['sender', 'worker'].map((id) => ({ id, name: id === 'sender' ? 'Отправитель' : 'Получатель', enabled: true,
    skills: [], mcps: ['pistudio-team'], plugins: [], instructions: [] }));
  writeFileSync(join(studio, '.pistudio/studio.json'), JSON.stringify({ schemaVersion: 1,
    sections: { agents, agentTeams: [{ id: 'team', name: 'Queue QA', agentIds: ['sender', 'worker'] }] } }));
  const snapshots = agents.map(({ instructions, ...profile }) => ({ profile, outputPath: `agents/${profile.id}/output` }));
  for (const agent of snapshots) mkdirSync(join(directory, agent.outputPath), { recursive: true });
  writeFileSync(join(directory, snapshots[1].outputPath, 'keep.txt'), 'USER_OUTPUT_UNCHANGED');
  writeFileSync(join(directory, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'project', name: 'Очередь MCP team',
    sourceTeamId: 'team', createdAt: 1, agents: snapshots }));
  const journal = join(directory, '.pistudio/team/messages'); mkdirSync(journal, { recursive: true });
  const ids = [];
  for (const requestId of ['cancel', 'resume']) {
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const id = hash(JSON.stringify(['project', 'sender', requestId])); ids.push(id);
    writeFileSync(join(journal, `${id}.json`), JSON.stringify({ version: 1, id, requestId, projectId: 'project', sourceTeamId: 'team',
      senderId: 'sender', recipientId: 'worker', createdAt: requestId === 'cancel' ? 1 : 2, updatedAt: 1,
      state: 'queued', text: 'Isolated undelivered task', bodyHash: hash('Isolated undelivered task'), lineage: ['sender'] }));
  }
  app.setPath('userData', userData); app.setPath('videos', root);
  const loaded = new Promise((resolve) => app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', () => resolve(win))));
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  window.webContents.setBackgroundThrottling(false);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => { console.error('Unsaved reload blocked'); app.exit(1); });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 140; i++) { if (await js(code)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw new Error('Timeout: ' + code);
  };
  const click = (text) => js(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`);
  await until(`!!document.querySelector('[aria-label="Открыть проект «Очередь MCP team»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Очередь MCP team»"]').click()`);
  await until(`document.body.innerText.includes('Поручения · 2')`);
  assert.equal(JSON.parse(await readFile(join(journal, `${ids[1]}.json`), 'utf8')).state, 'queued', 'Startup never dispatches');
  await click('Поручения · 2');
  await until(`!!document.querySelector('[role="dialog"]')`);
  await js(`document.querySelector('[role="dialog"] .disclosure-heading').click()`);
  await until(`document.body.innerText.includes('После перезапуска доставка не продолжалась автоматически.')`);
  await click('Отменить поручение');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal(JSON.parse(await readFile(join(journal, `${ids[0]}.json`), 'utf8')).state, 'queued');
  await js(`document.querySelector('[role="alertdialog"] .button.primary').click()`);
  await until(`!document.querySelector('[role="alertdialog"]')`);
  for (let i = 0; i < 40 && JSON.parse(await readFile(join(journal, `${ids[0]}.json`), 'utf8')).state !== 'cancelled'; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(JSON.parse(await readFile(join(journal, `${ids[0]}.json`), 'utf8')).state, 'cancelled');
  await js(`document.querySelectorAll('[role="dialog"] .disclosure-heading')[1].click()`);
  await click('Продолжить поручение');
  await until(`document.body.innerText.includes('Сообщение не отправлено.')`);
  assert.equal(JSON.parse(await readFile(join(journal, `${ids[1]}.json`), 'utf8')).state, 'failed', 'Only explicit resume reaches missing-model preflight');
  assert.equal(await readFile(join(directory, snapshots[1].outputPath, 'keep.txt'), 'utf8'), 'USER_OUTPUT_UNCHANGED');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/team-message-queue-ui.png'), (await window.capturePage()).toPNG());
  await writeFile(resolve('artifacts/team-message-queue-ui-proof.json'), JSON.stringify({ isolatedNative: true,
    restartAutoLaunch: false, pendingShown: true, confirmedCancel: true, explicitResumePreflight: true,
    modelRequests: 0, userStudioTouched: false, outputPreserved: true }, null, 2) + '\n');
  console.log('Native team queue UI passed; no model/Terminal/production studio access.');
  clearTimeout(timeout);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); app.exit(0);
})().catch(async (error) => {
  console.error(error); clearTimeout(timeout);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  app.exit(1);
});
