const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFile } = require('node:fs/promises');
const { once } = require('node:events');

module.exports = async ({ js, click, idle, until, w, pause }) => {
  const mouse = async (selector, dx) => {
    const point = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+${dx ?? 'r.width/2'}),y:Math.round(r.y+r.height/2)}})()`,
    );
    await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
    });
    await pause(35);
  };
  const clearPointer = async () => {
    await js('document.activeElement?.blur()');
    await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 800,
      y: 65,
    });
    await pause(35);
  };
  const border = (selector) =>
    js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).borderTopColor`);
  await js(`document.querySelector('.agent-team .agent-list-item').click()`);
  const headers = await js(
    `(()=>{const h=document.querySelector('.agent-editor-header'),r=h.getBoundingClientRect(),editor=document.querySelector('.agent-editor').getBoundingClientRect(),name=document.querySelector('.agent-name-input'),sw=document.querySelector('.agent-enabled-control .ui-switch').getBoundingClientRect(),heading=document.querySelector('.agent-list-group-heading');return {height:r.height,width:r.width,editorWidth:editor.width,nameFont:getComputedStyle(name).fontSize,switchWidth:sw.width,switchHeight:sw.height,headingWidth:heading.getBoundingClientRect().width,navWidth:heading.parentElement.getBoundingClientRect().width,columnWidth:document.querySelector('.agent-stages').getBoundingClientRect().width,headingHeight:heading.getBoundingClientRect().height,headingPadding:getComputedStyle(heading).padding}})()`,
  );
  assert.equal(headers.width, headers.editorWidth);
  assert.equal(headers.nameFont, '13px');
  assert.equal(headers.switchWidth, 42);
  assert.equal(headers.switchHeight, 25);
  assert.equal(headers.columnWidth, 320);
  assert.equal(headers.headingWidth, headers.navWidth);
  assert.equal(headers.headingPadding, '16px 20px');
  const action = '.agent-team .agent-list-entry > .hover-delete';
  await clearPointer();
  const before = await js(
    `(()=>{const a=document.querySelector(${JSON.stringify(action)}),r=a.getBoundingClientRect(),p=a.parentElement.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height,right:p.right-r.right}})()`,
  );
  assert.equal(before.right, 12);
  await mouse('.agent-team .agent-list-item', 20);
  await until(`getComputedStyle(document.querySelector(${JSON.stringify(action)})).opacity==='1'`);
  assert.equal(await border(action), 'rgba(0, 0, 0, 0)');
  await mouse(action);
  assert.notEqual(await border(action), 'rgba(0, 0, 0, 0)');
  assert.deepEqual(
    await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(action)}).getBoundingClientRect();return {x:r.x,width:r.width,height:r.height}})()`,
    ),
    { x: before.x, width: before.width, height: before.height },
  );
  await idle();
  const state = await js('window.studio.loadStudio()'),
    team = state.sections.agentTeams[0];
  const profiles = team.agentIds.map((id) => state.sections.agents.find((a) => a.id === id));
  const project = (
    await js(
      `window.studio.projectCommand(${JSON.stringify({ kind: 'create', name: 'Presentation QA', teamId: team.id, agents: profiles })})`,
    )
  ).projects.find((p) => p.name === 'Presentation QA');
  await writeFile(
    join(state.folder, 'projects', project.folderName, project.agents[0].outputPath, 'result.md'),
    '# Result',
  );
  const loaded = once(w.webContents, 'did-finish-load');
  w.webContents.reload();
  await loaded;
  await until(`!!document.querySelector('[aria-label="Открыть проект «Presentation QA»"]')`);
  await js(`document.querySelector('[aria-label="Открыть проект «Presentation QA»"]').click()`);
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='result.md')`,
  );
  await click('result.md');
  await until(`!!document.querySelector('.copy-output-button')`);
  const actual = await js(
    `(()=>{const h=document.querySelector('.project-column-heading'),t=document.querySelector('.project-file-toolbar');return {headingHeight:h.getBoundingClientRect().height,toolbarHeight:t.getBoundingClientRect().height,padding:getComputedStyle(h).padding}})()`,
  );
  assert.equal(headers.height, actual.toolbarHeight);
  assert.equal(headers.headingHeight, actual.headingHeight);
  assert.equal(headers.headingPadding, actual.padding);
  const split = '.project-agent-actions .split-button';
  const frame = () =>
    js(
      `getComputedStyle(document.querySelector(${JSON.stringify(split)}),'::after').borderTopColor`,
    );
  await clearPointer();
  assert.equal(await frame(), 'rgba(0, 0, 0, 0)');
  const dimensions = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(split)}).getBoundingClientRect();return {width:r.width,height:r.height}})()`,
  );
  await mouse('.project-agent-menu .section-menu-row', 20);
  assert.equal(await frame(), 'rgba(0, 0, 0, 0)');
  for (const part of ['.split-button-main', '.split-button-trigger']) {
    await mouse(split + ' ' + part);
    assert.equal(await frame(), 'rgba(0, 0, 0, 0)');
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector(${JSON.stringify(split + ' ' + part)})).borderTopWidth`,
      ),
      '0px',
    );
  }
  await js(`document.querySelector(${JSON.stringify(split + ' .split-button-trigger')}).focus()`);
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await until(`!!document.querySelector('[role="menu"]')`);
  await mouse('.project-header', 10);
  assert.equal(await frame(), 'rgba(0, 0, 0, 0)', 'Open portal keeps project controls borderless');
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(`!document.querySelector('[role="menu"]')`);
  await until(
    `document.activeElement===document.querySelector(${JSON.stringify(split + ' .split-button-trigger')})`,
  );
  await clearPointer();
  assert.equal(await frame(), 'rgba(0, 0, 0, 0)');
  assert.deepEqual(
    await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(split)}).getBoundingClientRect();return {width:r.width,height:r.height}})()`,
    ),
    dimensions,
  );
  await mouse('.copy-output-button');
  assert.equal(await border('.copy-output-button'), 'rgba(0, 0, 0, 0)');
  await clearPointer();
  assert.equal(await border('.copy-output-button'), 'rgba(0, 0, 0, 0)');
  await click('Агенты');
  await until(`!!document.querySelector('.agent-editor-header')`);
  return {
    headerHeight: headers.height,
    standardSwitch: [42, 25],
    actionRightInset: 12,
    matchingProjectColumnHeading: true,
    ownHoverBordersOnly: true,
    splitBorderlessAcrossPartsAndPortal: true,
    localCopyBorderlessOnHover: true,
    noLaunchOrClipboardRequests: true,
  };
};
