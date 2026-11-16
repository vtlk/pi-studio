const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const { cp, rm, writeFile, readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
let temporary;
const artifact = resolve(process.env.PI_STUDIO_QA_FILM_ARTIFACT || 'artifacts/film-workflow');
const deadline = setTimeout(() => {
  console.error('Real film viewer timed out');
  app.exit(1);
}, 60000);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
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
(async () => {
  app.setActivationPolicy('accessory');
  const proof = JSON.parse(readFileSync(join(artifact, 'proof.json'), 'utf8'));
  assert.equal(proof.actualAgentBashRender, true, 'Run test:pi-film first');
  const film = join(artifact, 'film.mp4');
  assert.equal(createHash('sha256').update(readFileSync(film)).digest('hex'), proof.sha256);
  const probe = JSON.parse(
    execFileSync(
      '/opt/homebrew/bin/ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', film],
      { encoding: 'utf8', timeout: 15000 },
    ),
  );
  const video = probe.streams.find((stream) => stream.codec_type === 'video'),
    audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.avg_frame_rate, '30/1');
  assert.equal(Number(video.nb_frames), 240);
  assert.equal(audio.codec_name, 'aac');
  assert.ok(Math.abs(Number(probe.format.duration) - 8) < 0.15);
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', film, '-f', 'null', '-'], {
    timeout: 20000,
    stdio: 'pipe',
  });
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-real-film-viewer-'));
  for (const key of ['documents', 'videos', 'userData']) {
    const path = join(temporary, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(name, name === 'studio:startup' ? () => ({ phase: 'skipped', message: 'QA' }) : action);
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  const window = await loaded;
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setAudioMuted(true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => void fail(Error('Unsaved QA reload')));
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      const error = await js(
        "document.querySelector('.native-video-viewer [role=alert]')?.textContent",
      );
      if (error) throw new Error(error);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  await until('!!document.querySelector(\'[aria-label="Создать проект"]\')');
  await js(
    `(async()=>{const before=await window.studio.loadStudio(); const saved=await window.studio.saveSection('agents',[{id:'film',name:'Готовый мультфильм',enabled:true,instructions:[],skills:[],mcps:[],plugins:[]}],{folder:before.folder,base:before.sections.agents});if(!saved.saved)throw new Error('QA save conflicted');await window.studio.projectCommand({kind:'create',name:'Капля заботы — готовый фильм',agents:[]});})()`,
  );
  const studio = await js('window.studio.loadStudio()'),
    project = studio.projects[0];
  const output = join(studio.folder, 'projects', project.folderName, project.agents[0].outputPath);
  await cp(artifact, output, { recursive: true });
  const request = {
    projectId: project.id,
    path: project.agents[0].outputPath + '/film.pistudio.json',
  };
  const inspected = await js(`window.studio.inspectVideoProject(${JSON.stringify(request)})`);
  assert.equal(inspected.ok, true, inspected.error);
  assert.equal(inspected.document.timeline.durationInFrames, 240);
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  const reloaded = new Promise((r) => window.webContents.once('did-finish-load', r));
  window.webContents.reload();
  await reloaded;
  await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});true`);
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Капля заботы — готовый фильм'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Капля заботы — готовый фильм')).click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()==='film.pistudio.json')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()==='film.pistudio.json').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Открыть монтаж')`,
  );
  await js(
    `window.__qaAudio=0;window.__qaAudioRms=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.length){window.__qaAudio++;const data=this.buffer.getChannelData(0);let squares=0;for(const value of data)squares+=value*value;window.__qaAudioRms=Math.max(window.__qaAudioRms,Math.sqrt(squares/data.length));}return start.apply(this,args)};void 0;`,
  );
  await click('Открыть монтаж');
  await until(`!!document.querySelector('.studio-remotion-player canvas')`);
  await until(`document.querySelector('.studio-remotion-player canvas').width>0`);
  await js(
    `window.__firstFrame=document.querySelector('.studio-remotion-player canvas').toDataURL();void 0;`,
  );
  await js(`document.querySelector('[aria-label=\"Воспроизвести\"]').click()`);
  await until(`Number(document.querySelector('[data-video-frame]').dataset.videoFrame)>30`);
  await until(`window.__qaAudio>0`);
  await until(`window.__qaAudioRms>0.0001`);
  await until(
    `document.querySelector('.studio-remotion-player canvas').toDataURL()!==window.__firstFrame`,
  );
  await js(`document.querySelector('[aria-label=\"Пауза\"]').click()`);
  const frame = await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`);
  await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await js(
    `window.__pausedFilmFrame=document.querySelector('.studio-remotion-player canvas').toDataURL();void 0`,
  );
  await js(`document.querySelector('button[aria-label="На кадр назад"]').click()`);
  await until(
    `document.querySelector('[data-video-frame]').dataset.videoFrame==='${Number(frame) - 1}'`,
  );
  await js(`document.querySelector('button[aria-label="На кадр вперёд"]').click()`);
  await until(`document.querySelector('[data-video-frame]').dataset.videoFrame==='${frame}'`);
  await until(
    `document.querySelector('.studio-remotion-player canvas').toDataURL()===window.__pausedFilmFrame`,
  );
  await click('На весь экран');
  assert.equal(
    await js(`!!document.querySelector('.native-video-viewer.editor-fullscreen .editor-timeline')`),
    true,
  );
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(
    await js(`!!document.querySelector('.native-video-viewer.editor-fullscreen')`),
    false,
  );
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), frame);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).some(b=>/Принять|Отменить принятие|Рендер MP4/.test(b.textContent))`,
    ),
    false,
  );
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await writeFile(join(artifact, 'studio-viewer.png'), (await window.capturePage()).toPNG());
  proof.nativeViewerVerified = true;
  proof.nativeAudioDecoded = true;
  proof.fullscreenPreservesFrame = true;
  const sources = [
    'scripts/smoke-film-viewer.cjs',
    'src/renderer/features/editor/player/VideoComposition.tsx',
    'src/renderer/features/editor/player/StereoPan.tsx',
    'src/renderer/features/editor/ui/VideoViewer.tsx',
    'src/main/video/readVideoProject.ts',
  ];
  proof.currentViewerCheck = {
    applicationVersion: require('../package.json').version,
    checkedAt: new Date().toISOString(),
    unchangedAgentMovieHash: true,
    fullFfmpegDecode: true,
    nativeMovingVideo: true,
    nativeDecodedNonSilentAudio: true,
    sameFramePixelsAfterStepBackAndForward: true,
    fullscreenEscapePreservesFrame: true,
    readOnlyWithoutApprovalExport: true,
    newModelRequests: 0,
    scope:
      'Previously real-agent-created movie in an isolated offscreen native main/preload/renderer. Startup skipped; document visibility simulated for polling. User studio untouched; no Terminal or generation.',
    sourceSha256: Object.fromEntries(
      await Promise.all(
        sources.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(resolve(path)))
            .digest('hex'),
        ]),
      ),
    ),
  };
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    'Real agent-created film passed native Electron: validated montage, moving decoded video, decoded audio, read-only tracks, no approval/export gates and fullscreen/Escape preserving frame.',
  );
  await cleanup();
  app.exit(0);
})().catch(fail);
