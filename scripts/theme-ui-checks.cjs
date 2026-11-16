const assert = require('node:assert/strict');
const { readFile, writeFile, mkdir, chmod, stat } = require('node:fs/promises');
const { join } = require('node:path');
module.exports = async ({
  root,
  window,
  js,
  until,
  click,
  named,
  field,
  saved,
  key,
  setTheme,
  capture,
  nativeTheme,
  initial,
}) => {
  const preferenceFile = join(root, 'UserData', 'appearance.json');
  assert.equal(initial.preference, 'system');
  await assert.rejects(stat(preferenceFile), { code: 'ENOENT' });
  // Override this QA application's source only; never change the user's OS preference.
  await js(
    'window.themeQaEvents=[];void window.studio.onThemeChanged(s=>window.themeQaEvents.push(s))',
  );
  const other = initial.theme === 'dark' ? 'light' : 'dark';
  nativeTheme.themeSource = other;
  nativeTheme.emit('updated');
  await until(`document.documentElement.dataset.theme===${JSON.stringify(other)}`);
  assert.equal((await js('window.studio.getTheme()')).preference, 'system');
  await assert.rejects(stat(preferenceFile), { code: 'ENOENT' });
  await setTheme('light');
  await js(`document.querySelector('.theme-toggle').focus()`);
  await key('Enter', 'Enter', 13, '\r');
  await until(`document.documentElement.dataset.theme==='dark'`);
  assert.equal(await js(`document.activeElement===document.querySelector('.theme-toggle')`), true);
  assert.equal(
    await js(`document.querySelector('.theme-toggle').getAttribute('aria-label')`),
    'Включить светлую тему',
  );
  await js(`document.querySelector('.theme-toggle').blur()`);
  await js(`document.querySelector('.theme-toggle').focus()`);
  await until(`!!document.querySelector('[role="tooltip"]')`);
  assert.equal(
    await js(
      `document.querySelector('[role="tooltip"]').textContent.includes('Включить светлую тему')`,
    ),
    true,
  );
  await js(
    `(()=>{const button=document.querySelector('.theme-toggle');button.click();button.click();})()`,
  );
  await until(`window.studio.getTheme().then(s=>s.theme==='dark')`);
  assert.equal(await js(`document.documentElement.dataset.theme`), 'dark');
  await click('Агенты');
  await named('Создать команду');
  await field('Название команды', 'Тема QA');
  await click('Создать');
  await saved();
  await named('Добавить агента в «Тема QA»');
  await saved();
  await field('Название агента', 'Сборщик');
  await click('Промпт');
  const text = Array.from(
    { length: 120 },
    (_, i) => `Строка ${i}: текущие инструкции без потерь.`,
  ).join('\n');
  await field('Основной промпт агента', text);
  await saved();
  await js(
    `(()=>{const t=document.querySelector('textarea');t.focus();t.setSelectionRange(30,70);t.scrollTop=320;document.querySelector('.main-scroll').scrollTop=0;window.themeQaText=t;})()`,
  );
  const editorState = () =>
    js(
      `(()=>{const t=document.querySelector('textarea');return {value:t.value,start:t.selectionStart,end:t.selectionEnd,scroll:t.scrollTop,outerScroll:document.querySelector('.main-scroll').scrollTop,focused:document.activeElement===t,same:t===window.themeQaText,heights:[document.querySelector('.topbar').offsetHeight,document.querySelector('.agent-editor-header').offsetHeight],columns:getComputedStyle(document.querySelector('.agents-workspace')).gridTemplateColumns};})()`,
    );
  const before = await editorState();
  await capture('agents-dark');
  await setTheme('light');
  assert.deepEqual(await editorState(), before);
  await capture('agents-light');
  await setTheme('dark');
  assert.deepEqual(await editorState(), before);
  const contrast = async (selectors) =>
    js(
      `(${function (selectors) {
        function rgb(value) {
          return (value.match(/[\d.]+/g) || []).map(Number);
        }
        function luminance(c) {
          return c
            .slice(0, 3)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        }
        function ratio(a, b) {
          const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (l[0] + 0.05) / (l[1] + 0.05);
        }
        return selectors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector))
            .filter((e) => e.getBoundingClientRect().width && e.getBoundingClientRect().height)
            .map((e) => {
              const style = getComputedStyle(e);
              let bg = [0, 0, 0, 0];
              for (let p = e; p; p = p.parentElement) {
                const c = rgb(getComputedStyle(p).backgroundColor);
                if (c.length >= 3 && (c[3] ?? 1) > 0) {
                  bg = c;
                  break;
                }
              }
              return {
                selector,
                text: e.textContent.trim().slice(0, 30),
                foreground: style.color,
                background: bg,
                contrast: ratio(rgb(style.color), bg),
                border:
                  style.borderTopWidth === '0px' ? undefined : ratio(rgb(style.borderTopColor), bg),
                opacity: style.opacity,
              };
            }),
        );
      }.toString()})(${JSON.stringify(selectors)})`,
    );
  const selectors = [
    '.topbar nav button',
    '.agent-list-item',
    '.section-menu-item',
    '.agent-name-input',
    'textarea',
    '.ui-list-row-label',
    '.column-heading',
  ];
  const pairs = [];
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    const values = await contrast(selectors);
    for (const v of values) assert.ok(v.contrast >= 4.5, JSON.stringify({ theme, ...v }));
    pairs.push({ theme, values });
  }
  await named('Агент включён');
  await saved();
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    const disabled = await contrast(['.agent-list-item[data-enabled="false"]']);
    assert.ok(disabled.length > 0);
    for (const value of disabled)
      assert.ok(value.contrast >= 4.5, JSON.stringify({ theme, ...value }));
    pairs.push({ theme, state: 'disabled', values: disabled });
  }
  await named('Агент включён');
  await saved();
  await setTheme('dark');
  // Radix menu and modal portals inherit the root palette while mounted.
  await js(`document.querySelector('.team-actions-menu').focus({preventScroll:true})`);
  await key('Enter', 'Enter', 13);
  await until(`!!document.querySelector('[role="menuitem"]')`);
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).map(e=>({text:e.textContent,icon:!!e.querySelector('svg[aria-hidden="true"]')}))`,
    ),
    ['Импорт команды', 'Экспорт команды', 'Удалить команду'].map((text) => ({ text, icon: true })),
  );
  const menu = await js(
    `(()=>{const e=document.querySelector('[role="menu"]');e.dataset.qa='same';return getComputedStyle(e).backgroundColor})()`,
  );
  await setTheme('light');
  assert.equal(await js(`document.querySelector('[role="menu"]').dataset.qa`), 'same');
  assert.notEqual(
    await js(`getComputedStyle(document.querySelector('[role="menu"]')).backgroundColor`),
    menu,
  );
  await key('Escape', 'Escape', 27);
  await click('MCP');
  await named('Добавить MCP');
  await until(`!!document.querySelector('[role="dialog"][data-size="wide"]')`);
  await setTheme('dark');
  await capture('resources-dark');
  const modalBg = await js(
    `getComputedStyle(document.querySelector('[role="dialog"]')).backgroundColor`,
  );
  await setTheme('light');
  assert.notEqual(
    await js(`getComputedStyle(document.querySelector('[role="dialog"]')).backgroundColor`),
    modalBg,
  );
  await click('Готово');
  await saved();
  const studio = await js('window.studio.loadStudio()');
  const project = await js(
    `window.studio.projectCommand({kind:'create',name:'Проверка темы',teamId:${JSON.stringify(studio.sections.agentTeams[0].id)},agents:[]})`,
  );
  const state = await js('window.studio.loadStudio()');
  const item = state.projects.find((p) => p.name === 'Проверка темы');
  assert.ok(item);
  const output = join(state.folder, 'projects', item.folderName, item.agents[0].outputPath);
  await mkdir(output, { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1488cc"/></svg>';
  await writeFile(join(output, 'color.svg'), svg);
  await writeFile(
    join(output, 'notes.md'),
    '# Документ\n\nСодержимое **Markdown**, поиск и цвета.\n',
  );
  await writeFile(join(output, 'data.json'), '{"theme":"media remains original"}');
  await saved();
  await click('Проекты');
  // Explicitly reload the owned QA renderer after saved fixture creation, never the user's window.
  await new Promise((done) => {
    window.webContents.once('did-finish-load', done);
    window.webContents.reload();
  });
  await until(`!!document.querySelector('[aria-label="Открыть проект «Проверка темы»"]')`);
  await named('Открыть проект «Проверка темы»');
  await until(`!!document.querySelector('.output-file-tree')`);
  const file = async (name) => {
    await until(
      `Array.from(document.querySelectorAll('.file-tree-item')).some(e=>e.textContent.trim()===${JSON.stringify(name)})`,
    );
    await js(
      `Array.from(document.querySelectorAll('.file-tree-item')).find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`,
    );
  };
  await file('notes.md');
  await until(`!!document.querySelector('.output-markdown h1')`);
  await js(
    `window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',metaKey:true,bubbles:true,cancelable:true}))`,
  );
  await until(`!!document.querySelector('.preview-findbar input')`);
  await js(
    `(()=>{const e=document.querySelector('.preview-findbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Документ');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    `document.querySelector('.preview-findbar [role="status"]')?.textContent.trim()==='1 / 1'`,
  );
  await setTheme('dark');
  await capture('project-dark');
  await setTheme('light');
  await capture('project-light');
  assert.equal(await js(`document.querySelector('.preview-findbar input').value`), 'Документ');
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    const values = await contrast([
      '.find-bar input',
      '.textarea-find-count',
      '.file-tree-item',
      '.project-agent-item',
      '.project-column-heading',
      '.output-markdown',
    ]);
    for (const v of values) assert.ok(v.contrast >= 4.5, JSON.stringify({ theme, ...v }));
    pairs.push({ theme, state: 'project-preview-search', values });
  }
  await file('data.json');
  await until(
    `document.querySelector('.output-preview')?.textContent.includes('media remains original')||document.body.textContent.includes('media remains original')`,
  );
  await file('color.svg');
  await until(
    `!!document.querySelector('.output-image img')||!!document.querySelector('.output-preview img')`,
  );
  const media = [];
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await until(
      `document.querySelector('.output-image img')?.complete&&document.querySelector('.output-image img')?.naturalWidth===64`,
    );
    const rendered = await js(
      `(()=>{const e=document.querySelector('.output-image img'),r=e.getBoundingClientRect();return {point:{x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1},filter:getComputedStyle(e).filter,src:e.src};})()`,
    );
    const bitmap = (await window.webContents.capturePage(rendered.point)).toBitmap();
    media.push({
      pixels: [bitmap[2], bitmap[1], bitmap[0], bitmap[3]],
      filter: rendered.filter,
      src: rendered.src,
    });
  }
  assert.deepEqual(media[0], media[1]);
  assert.deepEqual(media[0].pixels, [20, 136, 204, 255]);
  assert.equal(media[0].filter, 'none');
  assert.equal(await readFile(join(output, 'color.svg'), 'utf8'), svg);
  await click('Настройки');
  await click('Рабочее пространство');
  await js(`document.querySelector('[aria-label="Запуск агента"]').focus()`);
  await key('ArrowDown', 'ArrowDown', 40);
  await until(`!!document.querySelector('[role="listbox"]')`);
  const selectColor = await js(
    `getComputedStyle(document.querySelector('[role="listbox"]')).backgroundColor`,
  );
  await setTheme('light');
  assert.notEqual(
    await js(`getComputedStyle(document.querySelector('[role="listbox"]')).backgroundColor`),
    selectColor,
  );
  const selectPairs = await contrast(['[role="option"]']);
  for (const v of selectPairs) assert.ok(v.contrast >= 4.5, JSON.stringify(v));
  pairs.push({ theme: 'light', state: 'select', values: selectPairs });
  await key('Escape', 'Escape', 27);
  await setTheme('dark');
  await click('Выбрать папку');
  await until(`window.studio.loadStudio().then(s=>s.folder.endsWith('OtherStudio'))`);
  assert.equal((await js('window.studio.getTheme()')).preference, 'dark');
  // Real atomic-write error in owned userData; restore permissions before retry/cleanup.
  const dataFolder = join(root, 'UserData');
  let failed;
  await chmod(dataFolder, 0o500);
  try {
    failed = await js(`window.studio.setTheme('light')`);
    assert.ok(failed.error);
    await until(`!!document.querySelector('.theme-error')`);
    assert.equal(await js('document.documentElement.dataset.theme'), 'light');
    assert.equal(JSON.parse(await readFile(preferenceFile, 'utf8')).theme, 'dark');
  } finally {
    await chmod(dataFolder, 0o700);
  }
  await click('Повторить сохранение');
  await until(`!document.querySelector('.theme-error')`);
  for (
    let i = 0;
    i < 100 && JSON.parse(await readFile(preferenceFile, 'utf8')).theme !== 'light';
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(JSON.parse(await readFile(preferenceFile, 'utf8')).theme, 'light');
  await js(
    `Promise.all([window.studio.setTheme('dark'),window.studio.setTheme('light'),window.studio.setTheme('dark')])`,
  );
  await until(`document.documentElement.dataset.theme==='dark'`);
  assert.equal(JSON.parse(await readFile(preferenceFile, 'utf8')).theme, 'dark');
  await saved();
  return {
    controlledAppOnlySystemEvent: true,
    systemChoiceNotPersisted: true,
    keyboardSingleToggle: true,
    rapidSynchronousClicksUseLatestVisibleTheme: true,
    editorTextFocusSelectionScrollGeometryPreserved: true,
    portalMenuAndModalInheritTheme: true,
    teamMenuImportExportTrashLucideIcons: true,
    selectPortalAndDisabledOptionsReadable: true,
    previewFindQueryPreserved: true,
    measuredTextContrast: pairs,
    mediaPixelsUnchanged: media[0].pixels,
    studioSwitchPreservesPreference: true,
    actualAtomicWriteFailureVisibleAndRetryWorks: true,
    fastChoicesPersistLatest: true,
  };
};
