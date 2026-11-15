const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ window, js, until, file, output, copy }) => {
  const markdown = '# Поиск\n\nКрасный **корабль** плывёт.\n\n`КРАСНЫЙ корабль` возвращается.\n\n[Красный корабль](https://example.invalid/hidden-url) и `a.b[0]`.\n\nконец\n\nначало\n';
  await writeFile(join(output, 'find.md'), markdown);
  await writeFile(join(output, 'find.txt'), Array.from({ length: 160 }, (_, i) => `Строка ${i}`).join('\n') + '\nНайди финиш\nЕщё финиш');
  await writeFile(join(output, 'find.json'), '{"название":"Красный корабль","код":"a.b[0]"}');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const query = async (value, count) => {
    await js(`(()=>{const input=document.querySelector('[aria-label="Найти в файле"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`document.querySelector('.preview-findbar [role="status"]')?.textContent.trim()===${JSON.stringify((count ? '1' : '0') + ' / ' + count)}`);
  };
  const key = (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  await file('find.md');
  await until(`document.querySelector('.output-markdown h1')?.textContent==='Поиск'`);
  await js(`document.querySelector('.file-tree-item[aria-current="true"]').focus({preventScroll:true})`);
  key('F', ['meta']);
  await until(`!!document.querySelector('[aria-label="Найти в файле"]')`);
  const originalHtml = await js(`document.querySelector('.output-markdown').innerHTML`);
  await query('красный корабль', 3);
  assert.equal(await js(`CSS.highlights.get('pistudio-preview-matches').size`), 3);
  assert.equal(await js(`Array.from(CSS.highlights.get('pistudio-preview-current'))[0].toString()`), 'Красный корабль');
  assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Найти в файле');
  key('Enter');
  await until(`document.querySelector('.preview-findbar [role="status"]').textContent.trim()==='2 / 3'`);
  key('Enter', ['shift']);
  await until(`document.querySelector('.preview-findbar [role="status"]').textContent.trim()==='1 / 3'`);
  await js(`document.querySelector('[aria-label="Предыдущее совпадение"]').click()`);
  await until(`document.querySelector('.preview-findbar [role="status"]').textContent.trim()==='3 / 3'`);
  await js(`document.querySelector('[aria-label="Следующее совпадение"]').click()`);
  await until(`document.querySelector('.preview-findbar [role="status"]').textContent.trim()==='1 / 3'`);
  const location = await js(`(()=>{const range=Array.from(CSS.highlights.get('pistudio-preview-current'))[0],r=range.getClientRects()[0];return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const pixels = (await window.webContents.capturePage(location)).toBitmap();
  let yellow = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 36 && pixels[i+1] === 218 && pixels[i+2] === 255) yellow++;
  assert.ok(yellow > 20, 'Current match is painted yellow in actual Chromium pixels');
  assert.equal(await js(`(()=>{const r=document.querySelector('.preview-findbar').getBoundingClientRect(),pane=document.querySelector('.output-preview-pane').getBoundingClientRect();return r.left>=pane.left&&r.right<=pane.right&&r.top>=pane.top;})()`), true);
  await writeFile('artifacts/file-preview-find.png', (await window.webContents.capturePage()).toPNG());
  assert.equal(await js(`document.querySelector('.output-markdown').innerHTML`), originalHtml);
  await query('a.b[0]', 1);
  await query('hidden-url', 0);
  await query('конецначало', 0);
  await copy('find.md', markdown);
  key('Escape');
  await until(`!document.querySelector('.preview-findbar')`);
  assert.equal(await js(`CSS.highlights.has('pistudio-preview-matches')`), false);
  assert.equal(await js(`document.activeElement.getAttribute('aria-current')`), 'true');
  // Physical KeyF must also work with the Russian layout, without changing selection.
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'а',code:'KeyF',metaKey:true,bubbles:true,cancelable:true}))`);
  await until(`!!document.querySelector('.preview-findbar')`);
  await query('красный корабль', 3);
  await file('find.json');
  await until(`document.querySelector('.output-code')?.textContent.includes('название')`);
  await until(`document.querySelector('.preview-findbar [role="status"]')?.textContent.trim()==='1 / 1'`);
  assert.equal(await js(`Array.from(CSS.highlights.get('pistudio-preview-current'))[0].toString()`), 'Красный корабль');
  await file('empty.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Файл пуст.'`);
  await query('Файл пуст.', 0);
  await file('find.txt');
  await until(`document.querySelector('.output-text')?.textContent.includes('Найди финиш')`);
  const leftScroll = await js(`document.querySelector('.output-file-tree').scrollTop`);
  await query('финиш', 2);
  assert.ok(await js(`document.querySelector('.output-browser-content').scrollTop>500`));
  assert.equal(await js(`document.querySelector('.output-file-tree').scrollTop`), leftScroll);
  assert.equal(await js(`(()=>{const b=document.querySelector('.output-browser-content').getBoundingClientRect(),r=Array.from(CSS.highlights.get('pistudio-preview-current'))[0].getClientRects()[0];return r.top>=b.top&&r.bottom<=b.bottom;})()`), true);
  await writeFile(join(output, 'find.txt'), 'Новый финиш');
  await until(`document.querySelector('.output-text')?.textContent==='Новый финиш'`);
  await until(`document.querySelector('.preview-findbar [role="status"]')?.textContent.trim()==='1 / 1'`);
  assert.equal(await readFile(join(output, 'find.md'), 'utf8'), markdown);
  await file('notes.txt');
  await until(`document.querySelector('.output-text')?.textContent==='Текст результата'`);
  await query('Текст', 1);
  return { nativeCmdF: true, russianPhysicalKeyF: true, renderedMarkdownAcrossInlineNodes: true,
    currentMatchPaintedInChromium: true, literalCaseInsensitiveCyrillic: true, enterAndReverseAndWrap: true,
    markupAndRawCopyUnchanged: true, jsonAndEmptyPlaceholder: true, searchUpdatesOnSelectionAndReread: true,
    onlyPreviewColumnScrolls: true, escapeRemovesHighlightsAndRestoresFocus: true };
};
