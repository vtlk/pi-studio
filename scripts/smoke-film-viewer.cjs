const { app } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const { cp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
let temporary;
const artifact = resolve('artifacts/film-workflow');
const deadline = setTimeout(() => {
  console.error('Real film viewer timed out');
  app.exit(1);
}, 60000);
(async () => {
  const proof = JSON.parse(readFileSync(join(artifact, 'proof.json'), 'utf8'));
  assert.equal(proof.actualAgentBashRender, true, 'Run test:pi-film first');
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-real-film-viewer-'));
  for (const key of ['documents', 'videos', 'userData']) {
    const path = join(temporary, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) =>
      window.webContents.once('did-finish-load', () => resolve(window)),
    ),
  );
  require('../out/main/index.cjs');
  const window = await loaded;
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setAudioMuted(true);
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
  window.webContents.reload();
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
    `window.__qaAudio=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.length)window.__qaAudio++;return start.apply(this,args)};void 0;`,
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
  await until(
    `document.querySelector('.studio-remotion-player canvas').toDataURL()!==window.__firstFrame`,
  );
  await js(`document.querySelector('[aria-label=\"Пауза\"]').click()`);
  const frame = await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`);
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
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    'Real agent-created film passed native Electron: validated montage, moving decoded video, decoded audio, read-only tracks, no approval/export gates and fullscreen/Escape preserving frame.',
  );
  clearTimeout(deadline);
  await rm(temporary, { recursive: true, force: true });
  app.exit(0);
})().catch(async (error) => {
  clearTimeout(deadline);
  console.error(error);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  app.exit(1);
});
