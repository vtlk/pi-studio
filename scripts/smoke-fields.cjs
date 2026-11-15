const { app, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { rm, mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
let root;
const deadline = setTimeout(() => {
  console.error('Field style smoke timed out');
  app.exit(1);
}, 30000);
(async () => {
  root = mkdtempSync(join(tmpdir(), 'pistudio-fields-'));
  for (const key of ['videos', 'userData']) {
    const p = join(root, key);
    mkdirSync(p);
    app.setPath(key, p);
  }
  let loadFailure = false;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, action) =>
    handle(
      channel,
      channel === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : channel === 'studio:model-catalog'
          ? () => ({ providers: [], models: [] })
          : channel === 'studio:load'
            ? (...args) => {
                if (loadFailure) throw new Error('QA storage unavailable');
                return action(...args);
              }
            : action,
    );
  const loaded = new Promise((resolve) =>
    app.once('browser-window-created', (_, window) => {
      window.setSize(1280, 900);
      window.hide();
      window.on('show', () => window.hide());
      window.webContents.setBackgroundThrottling(false);
      window.webContents.once('did-finish-load', () => resolve(window));
    }),
  );
  require('./offscreen-main.cjs').loadOffscreenMain(process.env.PI_STUDIO_QA_MAIN);
  const window = await loaded,
    js = (code) => window.webContents.executeJavaScript(code, true);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  await window.webContents.debugger.sendCommand('DOM.enable');
  await window.webContents.debugger.sendCommand('CSS.enable');
  window.webContents.removeAllListeners('will-prevent-unload');
  window.webContents.on('will-prevent-unload', () => {
    console.error('QA reload before saved');
    app.exit(1);
  });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + code);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const properties = [
    'display',
    'width',
    'height',
    'min-height',
    'max-height',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'border-top-width',
    'border-top-color',
    'border-top-style',
    'border-top-left-radius',
    'border-bottom-right-radius',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'box-shadow',
    'opacity',
  ];
  const samples = {};
  const appearance = {};
  const focusSamples = {};
  const colors = async (name, selector, hover = false) => {
    const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    assert.ok(nodeId, selector);
    if (hover)
      await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: ['hover'],
      });
    const style = await js(
      `(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {background:s.backgroundColor,foreground:s.color,radius:s.borderTopLeftRadius,border:s.borderTopWidth,transform:s.textTransform};})()`,
    );
    const luminance = (color) => {
      const rgb = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const value = n / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const a = luminance(style.background),
      b = luminance(style.foreground);
    style.contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(style.contrast >= 4.5, `${name}: unreadable foreground/background`);
    appearance[name] = style;
    if (hover)
      await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: [],
      });
    return style;
  };
  const sample = async (name, selector) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    samples[name] = await js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(el);return Object.fromEntries(${JSON.stringify(properties)}.map(p=>[p,s.getPropertyValue(p)]));})()`,
    );
  };
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual(
    await js(`Array.from(document.querySelectorAll('.topbar nav button')).map(b=>b.textContent)`),
    ['Проекты', 'Библиотека', 'Агенты'],
  );
  const topbar = await colors('mainNavigation', '.topbar nav button[aria-current="page"]');
  assert.equal(topbar.transform, 'uppercase');
  assert.equal(topbar.radius, '6px');
  assert.equal(topbar.border, '0px');
  assert.ok(
    topbar.background
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .every((n) => n < 70),
  );
  await colors('mainNavigationHover', '.topbar nav button[aria-current="page"]', true);
  const settings = await colors('settingsButton', '.settings-button');
  assert.equal(settings.background, 'rgb(0, 0, 0)');
  assert.equal(settings.foreground, 'rgb(255, 255, 255)');
  await js(`document.querySelector('[aria-label="Создать проект"]').click()`);
  await until(`!!document.querySelector('[role="dialog"] input')`);
  await js(
    `(()=>{const el=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Style check');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await colors('primaryAction', '[role="dialog"] .button.primary');
  await colors('primaryActionHover', '[role="dialog"] .button.primary', true);
  await click('Отмена');
  await click('Агенты');
  await js(`document.querySelector('[aria-label="Добавить агента"]').click()`);
  await until(`!!document.querySelector('[aria-label="Основной промпт агента"]')`);
  assert.equal(
    await js(`document.querySelector('.agent-stages').getBoundingClientRect().width`),
    320,
  );
  const addBorders = await js(
    `(()=>{const s=getComputedStyle(document.querySelector('[aria-label="Добавить агента"]'));return ['Top','Right','Bottom','Left'].map(side=>({width:s['border'+side+'Width'],style:s['border'+side+'Style']}));})()`,
  );
  assert.ok(addBorders.every((border) => border.width === '1px' && border.style === 'dashed'));
  const pill = await colors('selectedAgent', '.agent-list-item.active');
  const rgb = pill.background
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
  assert.ok(rgb[0] > 200 && rgb[1] > 150 && rgb[2] < 150);
  await colors('selectedAgentHover', '.agent-list-item.active', true);
  await sample('name', '[aria-label="Название агента"]');
  await sample('prompt', '[aria-label="Основной промпт агента"]');
  const prompt = await js(
    `(()=>{const el=document.querySelector('[aria-label="Основной промпт агента"]'),s=getComputedStyle(el.parentElement);return {height:el.getBoundingClientRect().height,label:!!el.closest('label'),padding:s.padding,margin:s.margin};})()`,
  );
  const viewportHeight = await js('window.innerHeight');
  assert.equal(prompt.height, 2 * Math.max(360, viewportHeight - 240));
  assert.equal(prompt.label, false);
  assert.equal(prompt.padding, '0px');
  assert.equal(prompt.margin, '0px');
  for (const selector of [
    '[aria-label="Название агента"]',
    '[aria-label="Основной промпт агента"]',
  ]) {
    const focus = await js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();const s=getComputedStyle(el);return {outline:s.outlineWidth,shadow:s.boxShadow,style:s.outlineStyle,active:document.activeElement===el,focus:el.matches(':focus'),visible:el.matches(':focus-visible')};})()`,
    );
    focusSamples[selector] = focus;
    assert.equal(focus.style, 'none');
    assert.equal(focus.active, true);
    assert.equal(focus.shadow, 'none');
  }
  await click('Инструкции');
  await js(`document.querySelector('[aria-label="Добавить инструкцию"]').click()`);
  await until(`!!document.querySelector('.instruction-sortable textarea')`);
  await js(`document.querySelector('.instruction-sortable [aria-expanded]').click()`);
  const textareaResize = await js(`(()=>{
    const el=document.querySelector('.instruction-sortable textarea');
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return {initialHeight:r.height,width:r.width,x:r.right-5,y:r.bottom-5,
      viewportHeight:innerHeight,hit:document.elementFromPoint(r.right-5,r.bottom-5)?.tagName,
      resize:s.resize,shared:el.classList.contains('ui-textarea')};
  })()`);
  assert.equal(textareaResize.shared, true);
  assert.equal(textareaResize.resize, 'vertical');
  assert.equal(textareaResize.initialHeight, 320);
  const pointer = (type, x, y, extra = {}) =>
    window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, ...extra });
  await pointer('mouseMoved', textareaResize.x, textareaResize.y);
  await pointer('mousePressed', textareaResize.x, textareaResize.y, {
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let offset = 10; offset <= 90; offset += 10) {
    await pointer('mouseMoved', textareaResize.x, textareaResize.y + offset, {
      button: 'left',
      buttons: 1,
    });
    await js('new Promise(requestAnimationFrame)');
  }
  await pointer('mouseReleased', textareaResize.x, textareaResize.y + 90, {
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  textareaResize.resizedHeight = await js(
    `document.querySelector('.instruction-sortable textarea').getBoundingClientRect().height`,
  );
  assert.ok(
    textareaResize.resizedHeight >= textareaResize.initialHeight + 80,
    'Native resize handle must grow the field: ' + JSON.stringify(textareaResize),
  );
  const multiline = 'Первая строка\nВторая строка';
  await js(
    `(()=>{const el=document.querySelector('.instruction-sortable textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(multiline)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    `document.querySelector('.instruction-sortable textarea').value===${JSON.stringify(multiline)}`,
  );
  textareaResize.heightAfterEdit = await js(
    `document.querySelector('.instruction-sortable textarea').getBoundingClientRect().height`,
  );
  assert.equal(
    textareaResize.heightAfterEdit,
    textareaResize.resizedHeight,
    'Controlled edits must preserve manual size',
  );
  assert.equal(
    await js(
      `document.querySelector('.instruction-sortable textarea').getBoundingClientRect().width`,
    ),
    textareaResize.width,
  );
  await click('Модель');
  await colors('modelTab', 'nav[aria-label="Настройки агента"] .section-menu-item.active');
  await until(
    `!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Обновляем каталог'))`,
  );
  await sample('connection', '[aria-label="Подключение модели"]');
  await sample('model', '[aria-label="Модель агента"]');
  await sample('reasoning', '[aria-label="Уровень рассуждения (effort)"]');
  const modelFields = await js(
    `Array.from(document.querySelectorAll('.agent-model-fields > label')).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})`,
  );
  assert.equal(modelFields.length, 3);
  assert.ok(modelFields.every((field) => Math.abs(field.y - modelFields[0].y) < 1));
  assert.ok(
    modelFields.every(
      (field, index) =>
        !index || field.x >= modelFields[index - 1].x + modelFields[index - 1].width + 8,
    ),
  );
  await click('Итоговое задание');
  await until(`!!document.querySelector('textarea[aria-label="Итоговые инструкции"]')`);
  const modalTextarea = await js(`(()=>{
    const el=document.querySelector('textarea[aria-label="Итоговые инструкции"]');
    return {height:el.getBoundingClientRect().height,readOnly:el.readOnly,
      shared:el.classList.contains('ui-textarea'),resize:getComputedStyle(el).resize};
  })()`);
  assert.deepEqual(modalTextarea, {
    height: 400,
    readOnly: true,
    shared: true,
    resize: 'vertical',
  });
  await click('Закрыть');
  await js(`document.querySelector('[aria-label="Настройки"]').click()`);
  await sample('workspace', '.settings-field-row input');
  const file = resolve('artifacts/fields-before.json');
  if (process.argv.includes('--baseline')) {
    await mkdir(resolve('artifacts'), { recursive: true });
    await writeFile(file, JSON.stringify(samples, null, 2) + '\n');
  } else {
    if (process.argv.includes('--compare'))
      assert.deepEqual(
        samples,
        JSON.parse(await readFile(file, 'utf8')),
        'Accepted field appearance changed',
      );
    for (const [name, style] of Object.entries(samples)) {
      assert.equal(style['border-top-left-radius'], '0px', name);
      assert.equal(style['box-shadow'], 'none', name);
    }
  }
  if (!process.argv.includes('--baseline')) {
    await until(`document.querySelector('.prototype-label')?.textContent.includes('Сохранено')`);
    loadFailure = true;
    window.webContents.reload();
    await until(`!!document.querySelector('.startup-screen input')`);
    const startup = await js(
      `(()=>{const s=getComputedStyle(document.querySelector('.startup-screen input'));return {radius:s.borderTopLeftRadius,shadow:s.boxShadow};})()`,
    );
    assert.deepEqual(startup, { radius: '0px', shadow: 'none' });
  }
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/interface-style-proof.json'),
    JSON.stringify(
      {
        version: (await js('window.studio.getInfo()')).version,
        packagedEntry: !!process.env.PI_STUDIO_QA_MAIN,
        viewport: { width: 1280, height: 900 },
        samples,
        appearance,
        prompt,
        textareaResize,
        modalTextarea,
        modelFields,
        addBorders,
        focusSamples,
        boundaries: [
          'Offscreen native renderer/preload/main; hover CSS state and focus emulated in its DevTools target.',
          'No user studio, OS cursor/focus, credentials or model requests.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  clearTimeout(deadline);
  console.log(
    'Field styles passed: name, tall prompt, connection/model/reasoning and workspace fields.',
  );
  await rm(root, { recursive: true, force: true });
  app.exit(0);
})().catch(async (e) => {
  clearTimeout(deadline);
  console.error(e);
  if (root) await rm(root, { recursive: true, force: true });
  app.exit(1);
});
