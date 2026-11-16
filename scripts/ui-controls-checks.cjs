const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { writeVideoFixture } = require('./video-fixture.cjs');
module.exports = async ({
  root,
  window,
  js,
  until,
  click,
  named,
  field,
  key,
  saved,
  theme,
  capture,
  select,
  holdCatalog,
  release,
  providers,
  setProviders,
}) => {
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Настройки');
  await click('Подключения');
  holdCatalog();
  await named('Добавить подключение');
  await until(`!!document.querySelector('[aria-label="ID провайдера"]')`);
  assert.equal(await js(`document.querySelector('[aria-label="ID провайдера"]').disabled`), true);
  assert.equal(
    await js(`document.querySelector('[aria-label="ID провайдера"]').getAttribute('aria-busy')`),
    'true',
  );
  release();
  await until(`!document.querySelector('[aria-label="ID провайдера"]').disabled`);
  await field('[role="dialog"] .field-label input', 'QA connection');
  const before = (await js('window.studio.loadStudio()')).sections.connections;
  const openProvider = async () => {
    await js(`document.querySelector('[aria-label="ID провайдера"]').focus()`);
    await key('ArrowDown', 'ArrowDown', 40);
    await until(`!!document.querySelector('.ui-searchable-select [role="combobox"]')`);
  };
  const query = async (text) => {
    await field('.ui-searchable-select input', text);
    await js('new Promise(r=>requestAnimationFrame(r))');
  };
  await openProvider();
  assert.equal(await js(`document.activeElement.getAttribute('placeholder')`), 'Найти провайдера');
  const bounds = await js(
    `(()=>{const e=document.querySelector('.ui-searchable-select'),r=e.getBoundingClientRect(),list=e.querySelector('.ui-searchable-options');return {left:r.left,right:r.right,width:innerWidth,top:r.top,bottom:r.bottom,height:innerHeight,scroll:list.scrollHeight>list.clientHeight,horizontal:e.scrollWidth<=e.clientWidth+1};})()`,
  );
  assert.ok(
    bounds.left >= 0 &&
      bounds.right <= bounds.width &&
      bounds.top >= 0 &&
      bounds.bottom <= bounds.height &&
      bounds.scroll &&
      bounds.horizontal,
  );
  await query('QA-PROVIDER-17');
  assert.equal(
    await js(`document.querySelectorAll('.ui-searchable-options [role="option"]').length`),
    1,
  );
  assert.deepEqual((await js('window.studio.loadStudio()')).sections.connections, before);
  await query('ЗЕЛЁНЫЙ');
  assert.equal(
    await js(`document.querySelector('.ui-searchable-options [role="option"]').textContent`),
    'Зелёный поставщик · qa-provider-17',
  );
  await query('нет-такого');
  assert.equal(
    await js(`document.querySelector('.ui-select-empty').textContent.trim()`),
    'Провайдеры не найдены',
  );
  await key('Enter', 'Enter', 13, '\r');
  assert.ok(await js(`!!document.querySelector('.ui-searchable-select')`));
  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('.ui-searchable-select')`);
  assert.equal(await js(`document.querySelectorAll('[role="dialog"]').length`), 1);
  assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'ID провайдера');
  await openProvider();
  assert.equal(await js(`document.querySelector('.ui-searchable-select input').value`), '');
  await query('QA-PROVIDER-17');
  await key('Enter', 'Enter', 13, '\r');
  await until(`!document.querySelector('.ui-searchable-select')`);
  assert.equal(
    await js(
      `document.querySelector('[aria-label="ID провайдера"]').textContent.includes('qa-provider-17')`,
    ),
    true,
  );
  await openProvider();
  await query('Provider 18');
  await js(`document.querySelector('.ui-searchable-options [role="option"]').click()`);
  await until(`!document.querySelector('.ui-searchable-select')`);
  assert.equal(
    await js(
      `document.querySelector('[aria-label="ID провайдера"]').textContent.includes('qa-provider-18')`,
    ),
    true,
  );
  await openProvider();
  await query('QA-PROVIDER-17');
  await key('Enter', 'Enter', 13, '\r');
  await until(`!document.querySelector('.ui-searchable-select')`);
  await openProvider();
  await query('Зелёный');
  await capture('ui-controls-provider.png');
  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('.ui-searchable-select')`);
  const radii = [];
  const fields = async (label) => {
    const values = await js(
      `Array.from(document.querySelectorAll('input:not([type="range"]),textarea,.ui-select-trigger')).filter(e=>e.getBoundingClientRect().width>0).map(e=>({name:e.getAttribute('aria-label')||e.tagName,radius:getComputedStyle(e).borderTopLeftRadius,border:getComputedStyle(e).borderTopWidth}))`,
    );
    for (const v of values) assert.equal(v.radius, '6px', label + JSON.stringify(v));
    radii.push({ label, values });
  };
  for (const value of ['dark', 'light']) {
    await theme(value);
    await fields('connection-' + value);
  }
  await click('Сохранить');
  await until(`!document.querySelector('[role="dialog"]')`);
  await saved();
  const connections = (await js('window.studio.loadStudio()')).sections.connections;
  assert.equal(connections.length, before.length + 1);
  assert.equal(connections.at(-1).providerId, 'qa-provider-17');
  assert.equal(connections.at(-1).authScope, 'connection');
  setProviders(providers.filter((p) => p.id !== 'qa-provider-17'));
  await click('Настроить');
  await until(
    `document.querySelector('[aria-label="ID провайдера"]').textContent.includes('недоступен')`,
  );
  await openProvider();
  await query('qa-provider-17');
  assert.equal(
    await js(`document.querySelector('.ui-searchable-options [role="option"]').disabled`),
    true,
  );
  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('.ui-searchable-select')`);
  await click('Отмена');
  setProviders([]);
  await named('Добавить подключение');
  await until(`!!document.querySelector('[aria-label="ID провайдера"]:not(:disabled)')`);
  await openProvider();
  assert.equal(
    await js(`document.querySelector('.ui-select-empty').textContent.trim()`),
    'Провайдеры не найдены',
  );
  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('.ui-searchable-select')`);
  await select('Назначение подключения', 'Совместимый endpoint');
  assert.equal(await js(`!!document.querySelector('[aria-label="ID провайдера"]')`), false);
  await fields('custom-endpoint');
  await click('Отмена');
  setProviders(providers);
  await click('Агенты');
  await named('Создать команду');
  await field('[aria-label="Название команды"]', 'Geometry');
  await click('Создать');
  await saved();
  await named('Добавить агента в «Geometry»');
  await saved();
  await click('Промпт');
  const text = Array.from({ length: 80 }, (_, i) => 'Строка ' + i).join('\n');
  await field('[aria-label="Основной промпт агента"]', text);
  await saved();
  await js(
    `document.querySelector('textarea').focus();document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',metaKey:true,bubbles:true,cancelable:true}))`,
  );
  await until(`!!document.querySelector('.textarea-findbar')`);
  await field('.textarea-findbar input', 'Строка');
  await until(`document.querySelector('.textarea-find-count').textContent.includes('80')`);
  const height = await js(`document.querySelector('textarea').offsetHeight`);
  await js(`document.querySelector('.textarea-resize-handle').focus()`);
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await js(`document.querySelector('textarea').offsetHeight`), height + 20);
  for (const value of ['light', 'dark']) {
    await theme(value);
    await fields('textarea-' + value);
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.textarea-findbar')).borderTopLeftRadius`),
      '5px',
    );
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('.textarea-resize-handle')).borderBottomLeftRadius`,
      ),
      '5px',
    );
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.ui-switch')).borderRadius`),
      '14px',
    );
  }
  await key('Escape', 'Escape', 27);
  await saved();
  const state = await js('window.studio.loadStudio()');
  const result = await js(
    `window.studio.projectCommand({kind:'create',name:'Geometry QA',teamId:${JSON.stringify(state.sections.agentTeams[0].id)},agents:[]})`,
  );
  const project = result.projects.find((p) => p.name === 'Geometry QA');
  assert.ok(project);
  const output = join(state.folder, 'projects', project.folderName, project.agents[0].outputPath);
  await mkdir(output, { recursive: true });
  await writeVideoFixture(output);
  await writeFile(join(output, 'notes.md'), '# Geometry\n\nCurrent text.');
  await saved();
  await new Promise((done) => {
    window.webContents.once('did-finish-load', done);
    window.webContents.reload();
  });
  await until(`!!document.querySelector('[aria-label="Открыть проект «Geometry QA»"]')`);
  const controls = [];
  const inspect = async (label) => {
    const buttons = await js(
      `Array.from(document.querySelectorAll('[data-controls-scope="projects"] button:not(.ui-select-trigger):not([role="switch"]):not([role="checkbox"])')).filter(e=>e.getBoundingClientRect().width>0).map(e=>{const s=getComputedStyle(e);return {name:e.getAttribute('aria-label')||e.textContent.trim(),border:s.borderTopColor,outline:s.outlineStyle,shadow:s.boxShadow,radius:s.borderTopLeftRadius,split:!!e.closest('.split-button')};})`,
    );
    assert.ok(buttons.length);
    for (const v of buttons) {
      assert.ok(v.border === 'transparent' || v.border.endsWith(', 0)'), label + JSON.stringify(v));
      assert.equal(v.outline, 'none');
      assert.equal(v.shadow, 'none');
      if (!v.split) assert.equal(v.radius, '6px', label + JSON.stringify(v));
    }
    controls.push({ label, buttons });
  };
  await named('Создать проект');
  await until(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(
    await js(`document.querySelector('[role="dialog"]').dataset.controlsScope`),
    'projects',
  );
  await fields('project-name');
  await inspect('new-project-modal');
  await click('Отмена');
  await named('Открыть проект «Geometry QA»');
  await until(`!!document.querySelector('.file-tree-item')`);
  await click('notes.md');
  await until(`!!document.querySelector('.copy-output-button')`);
  await window.webContents.debugger.sendCommand('DOM.enable');
  await window.webContents.debugger.sendCommand('CSS.enable');
  const pseudo = async (selector, states) => {
    const d = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const n = await window.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: d.root.nodeId,
      selector,
    });
    assert.ok(n.nodeId);
    await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: n.nodeId,
      forcedPseudoClasses: states,
    });
  };
  for (const value of ['light', 'dark']) {
    await theme(value);
    await inspect('project-' + value);
    const size = await js(
      `(()=>{const r=document.querySelector('.split-button').getBoundingClientRect();return [r.width,r.height]})()`,
    );
    for (const selector of [
      '.project-agent-menu .section-menu-row',
      '.copy-output-button',
      '.split-button-main',
      '.split-button-trigger',
    ]) {
      await pseudo(selector, ['hover', 'focus-visible']);
      await inspect('hover-' + value);
      await pseudo(selector, []);
    }
    assert.deepEqual(
      await js(
        `(()=>{const r=document.querySelector('.split-button').getBoundingClientRect();return [r.width,r.height]})()`,
      ),
      size,
    );
    await js(`document.querySelector('.split-button-trigger').focus()`);
    await key('Enter', 'Enter', 13);
    await until(`!!document.querySelector('[role="menu"]')`);
    assert.equal(
      await js(`document.querySelector('[role="menu"]').dataset.controlsScope`),
      'projects',
    );
    await inspect('menu-' + value);
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.split-button'),'::after').content`),
      'none',
    );
    await key('Escape', 'Escape', 27);
    await until(`!document.querySelector('[role="menu"]')`);
  }
  await click('Перечитать агентов');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal(
    await js(`document.querySelector('[role="alertdialog"]').dataset.controlsScope`),
    'projects',
  );
  await inspect('confirmation');
  await click('Отмена');
  await named('Удаление файлов или диалогов с агентом');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await inspect('clear-data-modal');
  await named('Закрыть окно');
  await js(`document.querySelector('.split-button-main').click()`);
  await until(`document.body.textContent.includes('Сначала настройте подключение Агента')`);
  await inspect('missing-model-preflight');
  await click('Отмена');
  assert.equal(await readFile(join(output, 'notes.md'), 'utf8'), '# Geometry\n\nCurrent text.');
  assert.equal(
    (await js(`window.studio.readProject(${JSON.stringify(project.id)})`)).agents[0].session,
    undefined,
  );
  await capture('ui-controls-project.png');
  await click('film.pistudio.json');
  await until(
    `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Открыть монтаж')`,
  );
  await click('Открыть монтаж');
  await until(
    `!!document.querySelector('[data-montage-item="video-clip"] canvas')&&!!document.querySelector('[aria-label="На кадр вперёд"]')`,
  );
  await until(
    `document.querySelector('[data-montage-item="video-clip"] canvas').getContext('2d').getImageData(5,5,1,1).data[1]>90`,
  );
  await named('На кадр вперёд');
  await until(`document.querySelector('[data-video-frame]').dataset.videoFrame==='1'`);
  const pixel = await js(
    `Array.from(document.querySelector('[data-montage-item="video-clip"] canvas').getContext('2d').getImageData(5,5,1,1).data)`,
  );
  for (const value of ['light', 'dark']) {
    await theme(value);
    await inspect('montage-' + value);
    assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '1');
    assert.deepEqual(
      await js(
        `Array.from(document.querySelector('[data-montage-item="video-clip"] canvas').getContext('2d').getImageData(5,5,1,1).data)`,
      ),
      pixel,
    );
  }
  await click('На весь экран');
  await inspect('montage-fullscreen');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(`!document.querySelector('.editor-fullscreen')`);
  assert.equal(await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`), '1');
  await click('Закрыть просмотр');
  await saved();
  return {
    providerSearchByNameAndStableId: true,
    searchNeverSavesOrAuthenticates: true,
    emptyLoadingMissingIdAndCustomEndpointPreserved: true,
    mouseAndKeyboardExactProviderSelection: true,
    escapePreservesConnectionModalAndFocus: true,
    sharedFieldRadii: radii,
    textareaSearchAndKeyboardResizePreserved: true,
    projectScopePortalsAndModals: true,
    buttonStateSamples: controls,
    splitGeometryAndNoPseudoFrame: true,
    projectConfirmationsAndPreflightPreserved: true,
    projectFilesAndSessionsUntouched: true,
    officialRemotionViewerButtonsFullscreenFrameAndMediaColors: true,
  };
};
