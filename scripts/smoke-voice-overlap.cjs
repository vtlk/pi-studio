const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const { cp, rm, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { stereoProbe } = require('./stereo-check.cjs');

const artifact = resolve(process.env.PI_STUDIO_QA_VOICE_ARTIFACT || 'artifacts/voice-workflow');
const voices = ['d1.wav', 'd2.wav'];
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let temporary;
const deadline = setTimeout(() => fail(Error('Spoken overlap viewer timed out')), 45000);
async function cleanup() {
  clearTimeout(deadline);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
async function fail(error) {
  console.error(error);
  await cleanup();
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

(async () => {
  const origin = JSON.parse(readFileSync(join(artifact, 'proof.json'), 'utf8'));
  assert.equal(
    origin.actualAgentBashRender,
    true,
    'Requires existing real-agent voice QA artifacts.',
  );
  const before = voices.map((name) => hash(join(artifact, name)));
  assert.notEqual(before[0], before[1], 'Use two distinct spoken source files.');
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-spoken-overlap-'));
  for (const key of ['userData', 'videos']) {
    const path = join(temporary, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : action,
    );
  const loaded = new Promise((done) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.setAudioMuted(true);
      window.webContents.once('did-finish-load', () => done(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 300; i++) {
      const value = await js(code);
      if (value) return value;
      const error = await js(
        "document.querySelector('.native-video-viewer [role=alert]')?.textContent",
      );
      if (error) throw Error(error);
      await new Promise((done) => setTimeout(done, 20));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (name) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(`(async()=>{
    const before=await window.studio.loadStudio();
    const saved=await window.studio.saveSection('agents',[{id:'voices',name:'Реплики QA',enabled:true,instructions:[],skills:[],mcps:[],plugins:[]}],{folder:before.folder,base:before.sections.agents});
    if(!saved.saved)throw Error('QA save conflict');
    await window.studio.projectCommand({kind:'create',name:'Одновременные реплики QA',agents:[]});
  })()`);
  const studio = await js('window.studio.loadStudio()');
  const project = studio.projects[0];
  const agent = project.agents[0];
  const output = join(studio.folder, 'projects', project.folderName, agent.outputPath);
  await Promise.all(voices.map((name) => cp(join(artifact, name), join(output, name))));
  const timeline = {
    type: 'pi-studio.timeline',
    schemaVersion: 1,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 180,
    background: '#202020',
    assets: voices.map((name, i) => ({ id: `voice-${i}`, type: 'audio', src: name })),
    tracks: voices.map((_, i) => ({
      id: `track-${i}`,
      name: `Голос ${i + 1}`,
      type: 'audio',
      items: [
        {
          id: `line-${i}`,
          name: `Реплика ${i + 1}`,
          from: 30,
          duration: i === 0 ? 23 : 51,
          assetId: `voice-${i}`,
          volume: 0.6,
          pan: i === 0 ? -1 : 1,
        },
      ],
    })),
  };
  await writeFile(join(output, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(
    join(output, 'voices.pistudio.json'),
    JSON.stringify({
      type: 'pi-studio.video-project',
      schemaVersion: 1,
      editor: 'remotion-player',
      name: 'Две настоящие реплики',
      scope: 'film',
      state: './timeline.json',
    }),
  );
  const inspected = await js(
    `window.studio.inspectVideoProject(${JSON.stringify({ projectId: project.id, path: agent.outputPath + '/voices.pistudio.json' })})`,
  );
  assert.equal(inspected.ok, true, inspected.error);
  assert.equal(inspected.document.timeline.tracks.length, 2);
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => void fail(Error('Unsaved QA reload')));
  const reloaded = new Promise((done) => window.webContents.once('did-finish-load', done));
  window.webContents.reload();
  await reloaded;
  await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});true`);
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Одновременные реплики QA'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Одновременные реплики QA')).click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()==='voices.pistudio.json')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()==='voices.pistudio.json').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Открыть монтаж')`,
  );
  await js(stereoProbe);
  await click('Открыть монтаж');
  await until(`!!document.querySelector('.studio-remotion-player')`);
  await js(`document.querySelector('[aria-label="Воспроизвести"]').click()`);
  const measurement = (condition) => `(()=>{
    const frame=Number(document.querySelector('[data-video-frame]').dataset.videoFrame);
    const value=window.__readStereo();
    return (${condition}) ? {frame,...value} : false;
  })()`;
  const beforeVoices = await until(
    measurement(`frame>=6 && frame<20 && value.rms.every(r=>r<0.00001)`),
  );
  const overlap = await until(
    measurement(`frame>=30 && frame<53 && value.state==='running' && value.rms.every(r=>r>0.003)`),
  );
  assert.ok(await js(`window.__stereoPanners.filter(p=>!p.disconnected).length>=2`));
  const secondOnly = await until(
    measurement(
      `frame>=56 && frame<81 && value.state==='running' && value.rms[0]<0.00001 && value.rms[1]>0.003`,
    ),
  );
  await js(`document.querySelector('[aria-label="Пауза"]').click()`);
  await click('Закрыть просмотр');
  await until(`window.__stereoPanners.every(p=>p.disconnected)`);
  assert.equal(window.isVisible(), false);
  assert.equal(window.webContents.isAudioMuted(), true);
  assert.equal(window.webContents.isOffscreen(), true);
  assert.deepEqual(
    voices.map((name) => hash(join(artifact, name))),
    before,
  );
  const proof = {
    checkedAt: new Date().toISOString(),
    version: require('../package.json').version,
    sourceVoiceFiles: voices,
    sourceVoiceSha256: before,
    fixtureBasedOnRealAgentSpeech: true,
    fixtureTimingIsDeterministicQa: true,
    actualNativeMainPreloadRenderer: true,
    officialRemotionPlayer: true,
    validatedTwoTrackManifest: true,
    beforeVoices,
    overlap,
    secondOnly,
    allPannersDisconnected: true,
    offscreen: true,
    desktopAudioPlayback: false,
    originalVoiceFilesUnchanged: true,
    newModelRequests: 0,
    paidMediaApiCalls: 0,
    limits:
      'Native playback of overlapping distinct real speech files, isolated left/right to measure both independent channels. No subjective voice quality, continuous forced alignment or new model-authored overlap is claimed.',
  };
  await writeFile('artifacts/voice-overlap-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
  await cleanup();
  app.exit(0);
})().catch(fail);
