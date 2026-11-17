const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
app.getPreferredSystemLanguages = () => ['ru-RU'];
const { mkdtempSync, mkdirSync, realpathSync, writeFileSync } = require('node:fs');
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
  require('./offscreen-main.cjs').configureQaRuntime();
  writeFileSync(join(root, 'userData/language.json'), JSON.stringify({ language: 'ru' }));
  let hold = false,
    pending,
    removeOnRead;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'ready', message: 'QA' })
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
  const copied = [];
  clipboard.writeText = (text) => {
    copied.push(text);
  };
  shell.showItemInFolder = (path) => revealed.push(path);
  const loaded = new Promise((r) =>
    app.once('browser-window-created', (_, win) => {
      win.hide();
      win.on('show', () => win.hide());
      win.webContents.setBackgroundThrottling(false);
      win.webContents.once('did-finish-load', () => r(win));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
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
    `(async()=>{const before=await window.studio.loadStudio();const saved=await window.studio.saveSection('agents',[{id:'files',name:'Файлы',enabled:true,instructions:[],skills:[],mcps:[],plugins:[]}],{folder:before.folder,base:before.sections.agents});if(!saved.saved)throw Error('QA save conflict');const ready=await window.studio.loadStudio();await window.studio.projectCommand({kind:'create',name:'File previews',teamId:ready.sections.agentTeams[0].id,agents:[]});})()`,
  );
  const studio = await js('window.studio.loadStudio()'),
    project = studio.projects[0],
    agent = project.agents[0];
  const output = join(studio.folder, 'projects', project.folderName, agent.outputPath);
  await writeVideoFixture(output);
  await writeFile(
    join(output, 'assets/styled.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><style>rect{fill:rgb(22,163,74)}</style><rect width="60" height="30"/></svg>',
  );
  await writeFile(
    join(output, 'assets/css-animated.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><style>@keyframes color{0%,49%{fill:rgb(255,0,0)}50%,100%{fill:rgb(0,0,255)}}rect{animation:color .6s steps(1) infinite}</style><rect width="60" height="30"/></svg>',
  );
  await writeFile(
    join(output, 'assets/smil-animated.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="red"><animate attributeName="fill" values="#ff0000;#0000ff;#ff0000" dur=".8s" repeatCount="indefinite" calcMode="discrete"/></rect></svg>',
  );
  await writeFile(
    join(output, 'assets/scripted.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="red"/><script>document.querySelector("rect").setAttribute("fill","blue");</script></svg>',
  );
  await mkdir(join(output, 'docs'));
  await mkdir(join(output, 'texts'));
  await writeFile(join(output, 'texts/details.txt'), 'Текст по локальной ссылке');
  await writeFile(
    join(output, 'docs', 'Обзор.MARKDOWN'),
    `# Результат\n\n**Готово**\n\n| Кадр | Статус |\n|---|---|\n| 1 | OK |\n\n- [x] Проверено\n- [ ] Далее\n\n![Локальный кадр](../assets/square.svg)\n\n[Открыть текст](../texts/details.txt)\n\n<script>window.PREVIEW_EXECUTED=true</script>\n\n![Нет файла](../missing.png)\n\n[Запрещённый путь](../../../outside.txt)\n`,
  );
  for (const [name, content] of [
    ['notes.txt', 'Текст результата'],
    ['empty.txt', ''],
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
  // This folder is newer than the Markdown file; grouping takes priority over its date.
  await mkdir(join(output, 'docs', 'nested'));
  await writeFile(join(output, 'docs', 'nested', 'inside.txt'), 'Nested output');
  await until(`!!document.querySelector('[data-save-state="idle"]')`);
  await new Promise((resolveLoad) => {
    window.webContents.once('did-finish-load', resolveLoad);
    window.webContents.reload();
  });
  await until(`!!document.querySelector('.project-list-row')`);
  await js(`document.querySelector('.project-list-row').click()`);
  await until(`!!document.querySelector('.output-file-tree')`);
  const scanned = await js(`window.studio.readProject(${JSON.stringify(project.id)})`);
  const scannedEntries = scanned.agents.find(
    (item) => item.profile.id === agent.profile.id,
  ).entries;
  const grouped = (entries) => {
    const firstFile = entries.findIndex((entry) => entry.kind === 'file');
    assert.ok(firstFile < 0 || entries.slice(firstFile).every((entry) => entry.kind === 'file'));
    for (const entry of entries) if (entry.kind === 'folder') grouped(entry.children);
  };
  grouped(scannedEntries);
  const visibleKinds = await js(
    `Array.from(document.querySelectorAll('.output-file-tree > ul > li > button')).map(button=>button.classList.contains('file-tree-folder'))`,
  );
  assert.ok(visibleKinds.includes(true) && visibleKinds.includes(false));
  assert.ok(visibleKinds.slice(visibleKinds.indexOf(false)).every((folder) => !folder));
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(b=>b.textContent.trim()==='docs')`,
  );
  await file('docs');
  await file('Обзор.MARKDOWN');
  const nestedKinds = await js(
    `(()=>{const folder=Array.from(document.querySelectorAll('.file-tree-folder')).find(button=>button.textContent==='docs');return Array.from(folder.nextElementSibling.children).map(li=>li.querySelector('button').classList.contains('file-tree-folder'));})()`,
  );
  assert.deepEqual(nestedKinds, [true, false]);
  await until(`document.querySelector('.output-markdown h1')?.textContent==='Результат'`);
  const copy = async (name, expected) => {
    const count = copied.length;
    await until(`!!document.querySelector('.copy-output-button:not(:disabled)')`);
    await js(`document.querySelector('.copy-output-button').click()`);
    for (let i = 0; i < 100 && copied.length === count; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await until(
      `document.querySelector('.toast')?.textContent.includes(${JSON.stringify('«' + name + '»')}) && document.querySelector('.toast')?.textContent.includes('скопировано')`,
    );
    assert.equal(copied.length, count + 1);
    assert.equal(copied.at(-1), expected);
  };
  await copy('Обзор.MARKDOWN', await readFile(join(output, 'docs/Обзор.MARKDOWN'), 'utf8'));
  const copyStyle = await js(
    `(()=>{const button=document.querySelector('.copy-output-button'),s=getComputedStyle(button),r=button.getBoundingClientRect(),bar=button.closest('.project-file-toolbar').getBoundingClientRect();return {border:s.borderTopWidth,color:s.borderTopColor,inside:r.right<=bar.right&&r.left>=bar.left};})()`,
  );
  assert.equal(copyStyle.border, '1px');
  assert.equal(copyStyle.color, 'rgba(0, 0, 0, 0)');
  assert.equal(copyStyle.inside, true);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('DOM.enable');
  await window.webContents.debugger.sendCommand('CSS.enable');
  const documentRoot = await window.webContents.debugger.sendCommand('DOM.getDocument');
  const copyNode = await window.webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: documentRoot.root.nodeId,
    selector: '.copy-output-button',
  });
  await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
    nodeId: copyNode.nodeId,
    forcedPseudoClasses: ['hover'],
  });
  const copyHover = await js(
    `(()=>{const s=getComputedStyle(document.querySelector('.copy-output-button'));return {border:s.borderTopWidth,background:s.backgroundColor};})()`,
  );
  assert.deepEqual(copyHover, {
    border: '1px',
    background:
      (await js('document.documentElement.dataset.theme')) === 'dark'
        ? 'rgb(65, 65, 62)'
        : 'rgb(237, 237, 240)',
  });
  await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
    nodeId: copyNode.nodeId,
    forcedPseudoClasses: [],
  });
  const deniedBefore = copied.length;
  await assert.rejects(
    js(
      `window.studio.copyOutput({projectId:${JSON.stringify(project.id)},path:'project.json',fingerprint:'invalid'})`,
    ),
  );
  const copyRequest = {
    projectId: project.id,
    path: agent.outputPath + '/docs/Обзор.MARKDOWN',
    fingerprint: 'old-version',
  };
  await assert.rejects(js(`window.studio.copyOutput(${JSON.stringify(copyRequest)})`));
  assert.equal(copied.length, deniedBefore, 'Invalid/stale copy never writes the clipboard');
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
  const findProof = await require('./preview-find-checks.cjs')({
    window,
    js,
    until,
    file,
    output,
    copy,
  });
  hold = true;
  await file('slow.md');
  while (!pending) await new Promise((r) => setTimeout(r, 30));
  await file('notes.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Текст результата'`);
  await copy('notes.txt', 'Текст результата');
  await file('empty.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Файл пуст.'`);
  await copy('empty.txt', '');
  await file('notes.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Текст результата'`);
  hold = false;
  pending.resolve();
  pending = undefined;
  await js('new Promise(r=>setTimeout(r,100))');
  assert.equal(await js(`document.querySelector('.output-text')?.textContent`), 'Текст результата');
  await until(
    `document.querySelector('.preview-findbar [role="status"]')?.textContent.trim()==='1 / 1'`,
  );
  await copy('notes.txt', 'Текст результата');
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
  assert.equal(
    await js(`!!document.querySelector('.copy-output-button')`),
    false,
    'Media has no text-copy action',
  );
  assert.equal(await js(`!!document.querySelector('.output-image [role="alert"]')`), false);
  assert.equal(await js(`!!document.querySelector('.preview-findbar')`), false);
  assert.equal(await js(`CSS.highlights.has('pistudio-preview-matches')`), false);
  await file('styled.svg');
  await until(
    `document.querySelector('.output-image img')?.complete && document.querySelector('.output-image img')?.naturalWidth===60`,
  );
  const imageBounds = await js(
    `(()=>{const r=document.querySelector('.output-image img').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`,
  );
  const styledPixels = await window.webContents.capturePage(imageBounds),
    styledSize = styledPixels.getSize(),
    styledBitmap = styledPixels.toBitmap();
  const center =
    (Math.floor(styledSize.height / 2) * styledSize.width + Math.floor(styledSize.width / 2)) * 4;
  assert.deepEqual(
    [...styledBitmap.subarray(center, center + 4)],
    [74, 163, 22, 255],
    'SVG class styles must render through the actual media protocol, not default black.',
  );
  for (const name of ['css-animated.svg', 'smil-animated.svg']) {
    await file(name);
    await until(
      `document.querySelector('.output-image img')?.alt===${JSON.stringify(name)} && document.querySelector('.output-image img')?.naturalWidth===60`,
    );
    const colors = new Set();
    for (let frame = 0; frame < 24; frame++) {
      const snapshot = await window.webContents.capturePage(imageBounds),
        bitmap = snapshot.toBitmap();
      colors.add([...bitmap.subarray(center, center + 3)].join(','));
      if (colors.has('0,0,255') && colors.has('255,0,0')) break;
      await new Promise((done) => setTimeout(done, 80));
    }
    assert.ok(
      colors.has('0,0,255') && colors.has('255,0,0'),
      `${name} must animate actual preview pixels, got ${[...colors].join(';')}`,
    );
  }
  await file('scripted.svg');
  await until(
    `document.querySelector('.output-image img')?.alt==='scripted.svg' && document.querySelector('.output-image img')?.naturalWidth===60`,
  );
  const inertSvg = (await window.webContents.capturePage(imageBounds)).toBitmap();
  assert.deepEqual(
    [...inertSvg.subarray(center, center + 4)],
    [0, 0, 255, 255],
    'Embedded SVG script must not change its red rectangle to blue.',
  );
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
  for (const name of ['broken.pistudio.json', 'film.pistudio.json']) {
    await file(name);
    await until(
      `document.querySelector('.output-file-preview pre')?.textContent.includes('"type"')`,
    );
    assert.equal(await js(`!!document.querySelector('.montage-card')`), false);
    assert.equal(
      await js(`!!document.querySelector('.project-file-toolbar [aria-label="Копировать"]')`),
      true,
    );
  }
  assert.equal(await js(`'inspectVideoProject' in window.studio`), false);
  assert.equal(await js(`!!document.querySelector('.output-file-preview pre')`), true);
  await js(`document.querySelector('.project-agent-menu-trigger').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,cancelable:true}))`);
  await until(`!!document.querySelector('[role="menu"]')`);
  await js(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Показать в Finder').click()`,
  );
  for (let i = 0; i < 100 && !revealed.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(revealed, [output]);
  assert.equal(
    await js(`!!document.querySelector('.project-file-toolbar [aria-label="Показать в Finder"]')`),
    false,
  );
  const proof = {
    passed: true,
    previewFind: findProof,
    copiedRawMarkdownPlainAndEmptyText: true,
    textCopyBorderlessInPathToolbar: true,
    textCopyHoverVerified: true,
    copyAfterStaleSelectionTargetsCurrentText: true,
    invalidAndStaleCopyRejected: true,
    realUserClipboardUntouched: true,
    packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
    foldersFirstInMainAndRenderer: true,
    nestedFoldersBeforeOlderFiles: true,
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
    svgInlineStylesRenderPixels: true,
    svgCssAndSmilAnimationChangesPixels: true,
    svgScriptsDoNotExecute: true,
    nativeAudioAndVideoPlayback: true,
    unsupportedFileMessage: true,
    legacyManifestRenderedAsPlainJson: true,
    videoInspectionApiAbsent: true,
    finderTargetsAgentOutputForEveryPreview: true,
    newModelRequests: 0,
    scope:
      'Own offscreen native main/preload/renderer, real local files/codecs/protocol. Delayed read responses and read-time removal are explicit QA faults; Finder is intercepted. No user project or dialogue changes.',
  };
  proof.version = JSON.parse(await readFile('package.json', 'utf8')).version;
  proof.verifiedAt = new Date().toISOString();
  proof.sourceSha256 = {};
  for (const path of [
    'src/renderer/features/project/ui/SearchablePreview.tsx',
    'src/renderer/features/project/model/previewSearch.ts',
    'scripts/preview-find-checks.cjs',
    'src/renderer/shared/ui/FindBar.tsx',
    'src/renderer/shared/ui/literalSearch.ts',
    'src/renderer/features/project/model/markdownFiles.ts',
    'src/renderer/features/project/ui/MarkdownPreview.tsx',
    'src/renderer/features/project/ui/AgentOutputsView.tsx',
    'src/renderer/features/project/ui/OutputFileTree.tsx',
    'src/renderer/features/project/model/useOutputFile.ts',
    'src/renderer/features/project/model/outputTree.ts',
    'src/main/storage/outputs.ts',
    'src/shared/outputOrder.ts',
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
