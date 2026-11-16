const assert = require('node:assert/strict');

module.exports = async ({ root, js, until, click, row, main, menu, w, requests, reveals, commands }) => {
  const mode = `document.querySelector('.project-agent-heading [role="switch"]')`;
  const choose = async (text) => {
    await js(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
    await until(`!document.querySelector('[role="menuitem"]')`);
  };
  const clearFocus = async () => {
    await js('document.activeElement?.blur()');
    await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 900,
      y: 60,
    });
  };
  const toggle = async () => {
    await js(`${mode}.focus()`);
    await until(`document.activeElement===${mode}`);
    await w.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
    await w.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
  };
  assert.equal(await js(`${mode}.getAttribute('aria-checked')`), 'false');
  assert.equal(await js(`${mode}.querySelector('svg').classList.contains('lucide-pause')`), true);
  assert.equal(await js(`${main('bound-a')}.getAttribute('aria-label')`), 'Продолжить диалог');
  assert.equal(await js(`${main('fresh')}.getAttribute('aria-label')`), 'Запустить');
  assert.equal(
    await js(`document.querySelectorAll('.project-agent-actions .split-button').length`),
    0,
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.project-agent-actions')).every(e=>e.querySelectorAll('button').length===2)`,
    ),
    true,
  );
  for (const theme of ['light', 'dark']) {
    await js(`window.studio.setTheme(${JSON.stringify(theme)})`);
    await until(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
    await clearFocus();
    assert.equal(
      await js(
        `getComputedStyle(${row('bound-b')}.querySelector('.project-agent-menu-trigger')).opacity`,
      ),
      '0',
    );
    const before = await js(
      `(()=>{const r=${main('bound-b')}.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height}})()`,
    );
    const point = await js(
      `(()=>{const r=${row('bound-b')}.getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)}})()`,
    );
    await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
    });
    await until(
      `getComputedStyle(${row('bound-b')}.querySelector('.project-agent-menu-trigger')).opacity==='1'`,
    );
    assert.deepEqual(
      await js(
        `(()=>{const r=${main('bound-b')}.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height}})()`,
      ),
      before,
    );
    for (const selector of ['.project-agent-launch', '.project-agent-menu-trigger']) {
      const style = await js(
        `(()=>{const s=getComputedStyle(${row('bound-b')}.querySelector(${JSON.stringify(selector)}));return {radius:s.borderRadius,border:s.borderTopColor}})()`,
      );
      assert.equal(style.radius, '6px');
      assert.equal(style.border, 'rgba(0, 0, 0, 0)');
    }
    const selection = await js(
      `document.querySelector('.project-agent-menu .section-menu-item[aria-current="true"]').getAttribute('aria-label')`,
    );
    await menu('bound-b');
    const entries = await js(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).map(e=>({text:e.textContent.trim(),icons:e.querySelectorAll('svg').length}))`,
    );
    assert.deepEqual(
      entries.map((e) => e.text),
      [
        'Запустить и продолжить',
        'Показать в Finder',
        'Настройки агента',
        'Удалить агента из проекта',
      ],
    );
    assert.ok(entries.every((e) => e.icons === 1));
    assert.equal(
      await js(
        `document.querySelector('.project-agent-menu .section-menu-item[aria-current="true"]').getAttribute('aria-label')`,
      ),
      selection,
    );
    await clearFocus();
    assert.equal(
      await js(
        `getComputedStyle(${row('bound-b')}.querySelector('.project-agent-menu-trigger')).opacity`,
      ),
      '1',
    );
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(`!document.querySelector('[role="menuitem"]')`);
    await until(
      `document.activeElement===${row('bound-b')}.querySelector('.project-agent-menu-trigger')`,
    );
    await toggle();
    await until(`${mode}.getAttribute('aria-checked')==='true'`);
    assert.equal(await js(`${mode}.querySelector('svg').classList.contains('lucide-play')`), true);
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.project-agent-launch')).every(e=>e.getAttribute('aria-label')==='Запустить и продолжить'&&e.querySelector('.lucide-list-start'))`,
      ),
      true,
    );
    assert.equal(requests.length, 0, 'Theme, mode and menus send no launch request');
    await toggle();
    await until(`${mode}.getAttribute('aria-checked')==='false'`);
    assert.equal(await js(`${main('bound-b')}.getAttribute('aria-label')`), 'Продолжить диалог');
    assert.equal(await js(`${main('fresh')}.getAttribute('aria-label')`), 'Запустить');
  }
  await menu('bound-b');
  await choose('Показать в Finder');
  for (let i = 0; !reveals.length && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(reveals, [{ projectId: 'progress-project', agentId: 'bound-b' }]);
  const removeCount = () => commands.filter((c) => c.kind === 'remove-agent').length;
  await menu('bound-b');
  await choose('Удалить агента из проекта');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  assert.equal(removeCount(), 0);
  await click('Отмена');
  await until(`!document.querySelector('[role="alertdialog"]')`);
  assert.equal(removeCount(), 0);
  await menu('bound-b');
  await choose('Удалить агента из проекта');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await js(`document.querySelector('[role="alertdialog"] footer .primary').click()`);
  await until(`!(${row('bound-b')})`);
  assert.deepEqual(
    commands.find((c) => c.kind === 'remove-agent'),
    { kind: 'remove-agent', projectId: 'progress-project', agentId: 'bound-b' },
  );
  await click('Вернуть');
  await until(`!!(${row('bound-b')})`);
  await menu('bound-b');
  await choose('Настройки агента');
  await until(
    `document.querySelector('.project-inline-agent-settings [aria-label="Название агента"]')?.value==='bound-b'`,
  );
  assert.equal(await js(`!!document.querySelector('.project-header')`), true);
  assert.equal(await js(`document.querySelectorAll('.file-tree-item.active').length`), 0);
  assert.equal(await js(`document.querySelector('.output-preview-content').inert`), true);
  await until(
    `getComputedStyle(document.querySelector('.project-inline-agent-settings')).transform==='none'`,
  );
  const overlay = await js(
    `(()=>{const pane=document.querySelector('.output-preview-pane').getBoundingClientRect(),editor=document.querySelector('.project-inline-agent-settings').getBoundingClientRect();return {pane:[pane.x,pane.y,pane.width,pane.height],editor:[editor.x,editor.y,editor.width,editor.height],covered:getComputedStyle(document.querySelector('.project-file-toolbar')).visibility,animation:getComputedStyle(document.querySelector('.project-inline-agent-settings')).animationName}})()`,
  );
  assert.deepEqual(overlay.pane, overlay.editor);
  assert.equal(overlay.covered, 'hidden');
  assert.equal(overlay.animation, 'project-settings-enter');
  await require('node:fs/promises').writeFile(
    require('node:path').join(root, 'project-inline-settings.png'),
    (await w.webContents.capturePage()).toPNG(),
  );
  await click('Промпт');
  await js(
    `(()=>{const e=document.querySelector('.project-inline-agent-settings textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Inline exact profile B');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    `window.studio.loadStudio().then(s=>s.sections.agents.find(a=>a.id==='bound-b').mainInstruction==='Inline exact profile B')`,
  );
  assert.notEqual(
    await js(
      `window.studio.loadStudio().then(s=>s.sections.agents.find(a=>a.id==='bound-a').mainInstruction)`,
    ),
    'Inline exact profile B',
  );
  await click('Модель');
  assert.equal(
    await js(`!!document.querySelector('.project-inline-agent-settings .agent-model-fields')`),
    true,
  );
  await until(
    `Array.from(document.querySelectorAll('.file-tree-item')).some(e=>e.textContent.trim()==='result.md')`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-tree-item')).find(e=>e.textContent.trim()==='result.md').click()`,
  );
  await until(`!document.querySelector('.project-inline-agent-settings')`);
  assert.equal(await js(`document.querySelectorAll('.file-tree-item.active').length`), 1);
  assert.equal(await js(`document.querySelector('.output-preview-content').inert`), false);
  await menu('bound-b');
  await choose('Настройки агента');
  await until(`!!document.querySelector('.project-inline-agent-settings')`);
  await js(`${row('bound-b')}.querySelector('.section-menu-item').click()`);
  await until(`!document.querySelector('.project-inline-agent-settings')`);
  await menu('bound-b');
  await choose('Настройки агента');
  await until(`!!document.querySelector('.project-inline-agent-settings')`);
  await js(`${row('bound-a')}.querySelector('.section-menu-item').click()`);
  await until(`!document.querySelector('.project-inline-agent-settings')`);
  assert.equal(requests.length, 0, 'Settings and edits do not open Pi');
  await click('Агенты');
  await until(`document.querySelector('[aria-label="Название агента"]')?.value==='bound-b'`);
  await click('Промпт');
  assert.equal(
    await js(`document.querySelector('textarea[aria-label="Основной промпт агента"]').value`),
    'Inline exact profile B',
  );
  await click('Проекты');
  if (await js(`!!document.querySelector('[aria-label="Открыть проект «Launch progress»"]')`))
    await js(`document.querySelector('[aria-label="Открыть проект «Launch progress»"]').click()`);
  await until(`!!(${row('bound-a')})`);
  assert.equal(await js(`${mode}.getAttribute('aria-checked')`), 'false');
  return {
    rowMenuHoverFocusPortalAndIcons: true,
    borderlessStableGeometryBothThemes: true,
    modeSwitchKeyboardAllAgentsNoDispatch: true,
    finderTargetsRowAgent: true,
    deleteRequiresConfirmationAndScopedUndo: true,
    settingsTargetsExactProfileWithoutLaunch: true,
    inlineEditorCoversToolbarAndPreview: true,
    sharedEditorPersistenceAndFileAgentDismissal: true,
  };
};
