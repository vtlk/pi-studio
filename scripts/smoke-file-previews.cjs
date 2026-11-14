const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { mkdtempSync, mkdirSync, realpathSync } = require('node:fs');
const { mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { writeVideoFixture } = require('./video-fixture.cjs');
let root, window;
const deadline = setTimeout(() => {
  console.error('File preview timeout');
  app.exit(1);
}, 80000);
(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pistudio-file-previews-')));
  for (const key of ['userData', 'videos']) {
    mkdirSync(join(root, key));
    app.setPath(key, join(root, key));
  }
  let hold = false,
    pending,
    removeOnRead;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:read-output'
          ? async (event, request) => {
              if (removeOnRead && request.path.endsWith('gone.txt')) {
                await rm(removeOnRead);
                removeOnRead = undefined;
              }
              const result = await action(event, request);
              if (hold && /slow(?:-error)?\.md$/.test(request.path)) {
                await new Promise((resolveRead, rejectRead) => {
                  pending = { resolve: resolveRead, reject: rejectRead };
                });
              }
              return result;
            }
          : action,
    );
  const revealed = [];
  shell.showItemInFolder = (path) => revealed.push(path);
  const loaded = new Promise((r) =>
    app.once('browser-window-created', (_, win) => {
      win.hide();
      win.on('show', () => win.hide());
      win.webContents.setBackgroundThrottling(false);
      win.webContents.once('did-finish-load', () => r(win));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain();
  window = await loaded;
  window.webContents.setAudioMuted(true);
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('Unsaved QA reload');
    app.exit(1);
  });
  const js = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Preview expression:', code.slice(0, 400));
      throw error;
    });
  const until = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 60));
    }
    throw Error(code + '\n' + (await js('document.body.innerText.slice(-1300)')));
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const file = async (name) => {
    await until(
      `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()===${JSON.stringify(name)})`,
    );
    await js(
      `Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await js(
    `(async()=>{const before=await window.studio.loadStudio();const saved=await window.studio.saveSection('agents',[{id:'files',name:'Файлы',enabled:true,instructions:[],skills:[],mcps:[],plugins:[]}],{folder:before.folder,base:before.sections.agents});if(!saved.saved)throw Error('QA save conflict');await window.studio.projectCommand({kind:'create',name:'File previews',agents:[]});})()`,
  );
  const studio = await js('window.studio.loadStudio()'),
    project = studio.projects[0],
    agent = project.agents[0];
  const output = join(studio.folder, 'projects', project.folderName, agent.outputPath);
  await writeVideoFixture(output);
  await mkdir(join(output, 'docs'));
  await mkdir(join(output, 'texts'));
  await writeFile(join(output, 'texts/details.txt'), 'Текст по локальной ссылке');
  await writeFile(
    join(output, 'docs', 'Обзор.MARKDOWN'),
    `# Результат\n\n**Готово**\n\n| Кадр | Статус |\n|---|---|\n| 1 | OK |\n\n- [x] Проверено\n- [ ] Далее\n\n![Локальный кадр](../assets/square.svg)\n\n[Открыть текст](../texts/details.txt)\n\n<script>window.PREVIEW_EXECUTED=true</script>\n\n![Нет файла](../missing.png)\n\n[Запрещённый путь](../../../outside.txt)\n`,
  );
  for (const [name, content] of [
    ['notes.txt', 'Текст результата'],
    ['data.json', '{"answer":42}'],
    ['source.html', '<script>window.PREVIEW_EXECUTED=true</script>'],
    ['slow.md', '# Запоздавший файл'],
    ['slow-error.md', '# Запоздавшая ошибка'],
    ['gone.txt', 'Удаляется перед чтением'],
    ['bad.png', 'Not an image'],
    ['unsupported.bin', 'unsupported'],
    ['broken.pistudio.json', '{"type":"not-a-montage"}'],
  ])
    await writeFile(join(output, name), content);
  await until(`document.querySelector('.prototype-label')?.textContent==='Сохранено'`);
  await new Promise((resolveLoad) => {
    window.webContents.once('did-finish-load', resolveLoad);
    window.webContents.reload();
  });
  await until(`!!document.querySelector('.project-list-row')`);
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`!!document.querySelector('.output-file-tree')`);
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()==='docs')`,
  );
  await file('docs');
  await file('Обзор.MARKDOWN');
  await until(`document.querySelector('.output-markdown h1')?.textContent==='Результат'`);
  await until(
    `document.querySelector('.output-markdown img[alt="Локальный кадр"]')?.naturalWidth===40`,
  );
  assert.equal(await js(`document.querySelector('.output-markdown strong').textContent`), 'Готово');
  assert.equal(await js(`document.querySelectorAll('.output-markdown td').length`), 2);
  assert.equal(await js(`document.querySelectorAll('.markdown-task-marker').length`), 2);
  assert.equal(await js('window.PREVIEW_EXECUTED'), undefined);
  assert.equal(await js(`document.querySelectorAll('.output-markdown input').length`), 0);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.output-markdown a')).some(a=>a.textContent==='Запрещённый путь')`,
    ),
    false,
  );
  assert.ok(
    (await js(`document.querySelector('.output-markdown').textContent`)).includes(
      'Ссылка недоступна',
    ),
  );
  assert.equal(
    await js(`document.querySelector('.project-active-file').textContent`),
    agent.outputPath + '/docs/Обзор.MARKDOWN',
  );
  assert.equal(
    await js(`document.querySelectorAll('.output-browser-content .project-active-file').length`),
    0,
  );
  const src = await js(`document.querySelector('.output-markdown img[alt="Локальный кадр"]').src`);
  assert.ok(src.startsWith('studio-media://output/'));
  await until(
    `document.querySelector('.output-markdown')?.textContent.includes('Изображение недоступно')`,
  );
  const old = src;
  await writeFile(
    join(output, 'assets/square.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="blue"/></svg>',
  );
  await until(
    `document.querySelector('.output-markdown img[alt="Локальный кадр"]')?.naturalWidth===60`,
  );
  assert.notEqual(
    await js(`document.querySelector('.output-markdown img[alt="Локальный кадр"]').src`),
    old,
  );
  assert.deepEqual(
    await js(
      `(()=>{const style=getComputedStyle(document.querySelector('.output-file-preview'));return [style.borderTopWidth,style.borderRadius,style.paddingTop];})()`,
    ),
    ['0px', '0px', '0px'],
  );
  await mkdir(resolve('artifacts'), { recursive: true });
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await writeFile(
    resolve('artifacts/file-preview-markdown.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await js(
    `Array.from(document.querySelectorAll('.output-markdown a')).find(a=>a.textContent==='Открыть текст').click()`,
  );
  await until(`document.querySelector('.output-text')?.textContent==='Текст по локальной ссылке'`);
  await until(
    `document.querySelector('.file-tree-item[aria-current="true"]')?.textContent.trim()==='details.txt'`,
  );
  await file('data.json');
  await until(`document.querySelector('.output-code')?.textContent==='{"answer":42}'`);
  await file('source.html');
  await until(`document.querySelector('.output-text')?.textContent.includes('<script>')`);
  assert.equal(await js('window.PREVIEW_EXECUTED'), undefined);
  hold = true;
  await file('slow.md');
  while (!pending) await new Promise((r) => setTimeout(r, 30));
  await file('notes.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Текст результата'`);
  hold = false;
  pending.resolve();
  pending = undefined;
  await js('new Promise(r=>setTimeout(r,100))');
  assert.equal(await js(`document.querySelector('.output-text')?.textContent`), 'Текст результата');
  hold = true;
  await file('slow-error.md');
  while (!pending) await new Promise((r) => setTimeout(r, 30));
  await file('data.json');
  await until(`!!document.querySelector('.output-code')`);
  hold = false;
  pending.reject(Error('Delayed QA read error'));
  pending = undefined;
  await js('new Promise(r=>setTimeout(r,100))');
  assert.equal(
    await js(`!!document.querySelector('.output-browser-content [role="alert"]')`),
    false,
  );
  removeOnRead = join(output, 'gone.txt');
  await file('gone.txt');
  await until(`!!document.querySelector('.output-browser-content [role="alert"]')`);
  assert.ok(
    (
      await js(`document.querySelector('.output-browser-content [role="alert"]').textContent`)
    ).includes('Выбранный файл больше недоступен'),
  );
  await file('notes.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Текст результата'`);
  await file('bad.png');
  await until(
    `document.querySelector('.output-image [role="alert"]')?.textContent.includes('Не удалось открыть изображение')`,
  );
  await js(
    `(()=>{const folder=Array.from(document.querySelectorAll('.file-tree-item')).find(b=>b.textContent.trim()==='assets');if(folder.getAttribute('aria-expanded')!=='true')folder.click();})()`,
  );
  await file('square.svg');
  await until(`document.querySelector('.output-image img')?.naturalWidth===60`);
  assert.equal(await js(`!!document.querySelector('.output-image [role="alert"]')`), false);
  for (const [name, tag] of [
    ['tone.wav', 'audio'],
    ['clip.mp4', 'video'],
  ]) {
    await file(name);
    await until(`document.querySelector('.output-file-preview ${tag}')?.readyState>=2`);
    await js(`document.querySelector('.output-file-preview ${tag}').play()`);
    await until(`document.querySelector('.output-file-preview ${tag}')?.currentTime>0.1`);
    await js(`document.querySelector('.output-file-preview ${tag}').pause()`);
  }
  await file('unsupported.bin');
  await until(
    `document.querySelector('.media-example')?.textContent.includes('нет встроенного предпросмотра')`,
  );
  await file('broken.pistudio.json');
  await until(`document.querySelector('.montage-card [role="alert"]')?.textContent.length>0`);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Открыть монтаж')`,
    ),
    false,
  );
  await file('film.pistudio.json');
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Открыть монтаж')`,
  );
  await js(
    `document.querySelector('.project-agent-actions [aria-label="Показать в Finder"]').click()`,
  );
  for (let i = 0; i < 100 && !revealed.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(revealed, [output]);
  assert.equal(
    await js(`!!document.querySelector('.project-file-toolbar [aria-label="Показать в Finder"]')`),
    false,
  );
  const proof = {
    passed: true,
    markdownLocalImage: true,
    imageUpdatesWithoutMarkdownEdit: true,
    localLinkSelectsFile: true,
    linkedFolderExpands: true,
    gfmTasksAndTables: true,
    rawHtmlNeverExecuted: true,
    toolbarPathOnce: true,
    staleReadAndErrorIgnored: true,
    missingReadErrorVisible: true,
    brokenMediaErrorClearsOnSelection: true,
    nativeAudioAndVideoPlayback: true,
    unsupportedFileMessage: true,
    manifestValidation: true,
    finderTargetsAgentOutputForEveryPreview: true,
    newModelRequests: 0,
    scope:
      'Own offscreen native main/preload/renderer, real local files/codecs/protocol. Delayed read responses and read-time removal are explicit QA faults; Finder is intercepted. No user project or dialogue changes.',
  };
  proof.version = JSON.parse(await readFile('package.json', 'utf8')).version;
  proof.verifiedAt = new Date().toISOString();
  proof.sourceSha256 = {};
  for (const path of [
    'src/renderer/features/project/model/markdownFiles.ts',
    'src/renderer/features/project/ui/MarkdownPreview.tsx',
    'src/renderer/features/project/ui/AgentOutputsView.tsx',
    'src/renderer/features/project/ui/OutputFileTree.tsx',
    'src/renderer/features/project/model/useOutputFile.ts',
    'src/main/storage/outputs.ts',
    'src/shared/outputPaths.ts',
    'scripts/smoke-file-previews.cjs',
    'out/main/index.cjs',
  ])
    proof.sourceSha256[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/file-preview-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log('File previews passed:', JSON.stringify(proof));
  clearTimeout(deadline);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  clearTimeout(deadline);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(1);
});
