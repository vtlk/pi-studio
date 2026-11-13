const { app } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { writeVideoFixture } = require('./video-fixture.cjs');

let temporary;
const deadline = setTimeout(() => {
  console.error('Video smoke timed out');
  app.exit(1);
}, 60000);
(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'pistudio-viewer-'));
  for (const key of ['documents', 'videos', 'userData']) {
    const path = join(temporary, key);
    mkdirSync(path);
    app.setPath(key, path);
  }
  const loaded = new Promise((resolve, reject) =>
    app.once('browser-window-created', (_, window) => {
      window.webContents.once('did-finish-load', () => resolve(window));
      window.webContents.once('did-fail-load', (_, code, description) =>
        reject(new Error(`${code}: ${description}`)),
      );
    }),
  );
  require('../out/main/index.cjs');
  const window = await loaded;
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(event.message);
  });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  async function until(code) {
    for (let n = 0; n < 160; n++) {
      if (await js(code)) return;
      const error = await js(
        `document.querySelector('.native-video-viewer [role="alert"]')?.textContent`,
      );
      if (error) throw new Error(error);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error(
      `Assertion timed out: ${code}\n${await js('document.body.innerText')}\n${JSON.stringify(await js(`({hidden:document.hidden,audio:window.__audioStarted,controls:Array.from(document.querySelectorAll('.studio-remotion-player button')).map(b=>({label:b.getAttribute('aria-label'),text:b.innerText}))})`))}`,
    );
  }
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`,
    );
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `(async()=>{const before=await window.studio.loadStudio();const result=await window.studio.saveSection('agents', [{id:'viewer',name:'Монтаж',enabled:true,instructions:[],skills:[],mcps:[],plugins:[]}],{folder:before.folder,base:before.sections.agents});if(!result.saved)throw new Error('Fixture save conflicted')})()`,
  );
  await js(`window.studio.projectCommand({kind:'create',name:'Видео smoke',agents:[]})`);
  const studio = await js('window.studio.loadStudio()'),
    project = studio.projects[0];
  const output = join(studio.folder, 'projects', project.folderName, project.agents[0].outputPath);
  await writeVideoFixture(output);
  const request = {
    projectId: project.id,
    path: `${project.agents[0].outputPath}/film.pistudio.json`,
  };
  const inspected = await js(`window.studio.inspectVideoProject(${JSON.stringify(request)})`);
  assert.equal(inspected.ok, true, inspected.error);
  window.webContents.reload();
  await until(
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Видео smoke'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Видео smoke')).click()`,
  );
  await until(`!!document.querySelector('.project-header h1')`);
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b => b.textContent.trim() === 'film.pistudio.json')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b => b.textContent.trim() === 'film.pistudio.json').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Открыть монтаж')`,
  );
  assert.equal(await js(`!!document.querySelector('[aria-label="Показать в Finder"]')`), false);
  await js(
    `window.__audioStarted=0; const originalAudioStart=AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start=function(...args){ if(this.buffer?.length>0) window.__audioStarted++; return originalAudioStart.apply(this,args); }; void 0;`,
  );
  await click('Открыть монтаж');
  await until(
    `!!document.querySelector('.studio-remotion-player [data-montage-item="video-clip"] canvas')`,
  );
  await until(
    `document.querySelector('[data-montage-item="moving-square"] img')?.naturalWidth === 40`,
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.remotion-step-control')).color`),
    'rgb(255, 255, 255)',
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.remotion-mute-control')).color`),
    'rgb(255, 255, 255)',
  );
  const pixel = (x, y) =>
    js(
      `Array.from(document.querySelector('[data-montage-item="video-clip"] canvas').getContext('2d').getImageData(${x},${y},1,1).data)`,
    );
  await until(
    `document.querySelector('[data-montage-item="video-clip"] canvas').getContext('2d').getImageData(5,5,1,1).data[1] > 90`,
  );
  const green = await pixel(5, 5);
  assert.ok(green[1] > 90 && green[0] < 30, `Video pixel: ${green}`);
  // CORS/taint checks also prove export can use the same native image/video sources.
  assert.match(
    await js(
      `document.querySelector('[data-montage-item="video-clip"] canvas').toDataURL().slice(0,30)`,
    ),
    /^data:image\/png;base64,/,
  );
  await js(`document.querySelector('[aria-label="Клип Движущийся квадрат"]').click()`);
  await js(`document.querySelector('[aria-label="Воспроизвести"]').click()`);
  await until(`Number(document.querySelector('[data-video-frame]').dataset.videoFrame) >= 3`);
  await until(`window.__audioStarted > 0`);
  await js(`document.querySelector('[aria-label="Пауза"]').click()`);
  for (
    let frame = Number(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`));
    frame < 19;
    frame++
  ) {
    await js(`document.querySelector('[aria-label="На кадр вперёд"]').click()`);
    await until(
      `document.querySelector('[data-video-frame]').dataset.videoFrame === '${frame + 1}'`,
    );
  }
  assert.equal(
    await js(`document.querySelector('[data-montage-item="moving-square"]').style.left`),
    '100px',
  );
  assert.equal(
    await js(`document.querySelector('[data-montage-item="caption"]').textContent`),
    'ПРОВЕРКА МОНТАЖА',
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
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '19');
  assert.equal(
    await js(
      `document.querySelector('[aria-label="Клип Движущийся квадрат"]').getAttribute('aria-pressed')`,
    ),
    'true',
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/video-viewer.png'), (await window.capturePage()).toPNG());
  await click('Закрыть просмотр');
  await click('Открыть монтаж');
  await until(`!!document.querySelector('.studio-remotion-player')`);
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '19');
  await writeFile(
    join(output, 'scene.pistudio.json'),
    JSON.stringify({
      type: 'pi-studio.video-project',
      schemaVersion: 1,
      editor: 'remotion-player',
      name: 'Отдельная сцена',
      scope: 'scene',
      state: './timeline.json',
    }),
  );
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()==='scene.pistudio.json')`,
  );
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '19');
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()==='scene.pistudio.json').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Открыть монтаж')`,
  );
  await click('Открыть монтаж');
  await until(`!!document.querySelector('[data-video-frame]')`);
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '0');
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()==='film.pistudio.json').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Открыть монтаж')`,
  );
  await click('Открыть монтаж');
  await until(`!!document.querySelector('[data-video-frame]')`);
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '19');
  await writeFile(
    join(output, 'assets/square.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>',
  );
  const changed = await js(`window.studio.inspectVideoProject(${JSON.stringify(request)})`);
  assert.notEqual(changed.document.revision, inspected.document.revision);
  await until(`document.querySelector('[data-video-frame]')?.dataset.videoFrame === '0'`);
  console.log(
    'Official Remotion Player passed: safe manifest/assets, SVG keyframes, video pixel decoding, real decoded audio playback, read-only clips, fullscreen/Escape, preserved view state and dependency revision.',
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
