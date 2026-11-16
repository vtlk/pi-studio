const assert = require('node:assert/strict');
module.exports = async ({
  js,
  until,
  click,
  field,
  saved,
  load,
  named,
  key,
  window,
  refuseSaves,
}) => {
  await saved();
  window.webContents.reload();
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  await click('Агенты');
  const initial = await load(),
    team = initial.sections.agentTeams[0];
  const first = team.agentIds[0],
    second = team.agentIds[1];
  const profile = async (id) => {
    const s = await load();
    return [...s.sections.agents, ...s.sections.systemAgents].find((a) => a.id === id);
  };
  const select = async (index) => {
    await js(
      `document.querySelectorAll('[data-team-id="${team.id}"] .agent-list-item')[${index}].click()`,
    );
    await click('MCP');
  };
  const attach = async (custom = false) => {
    await named('Добавить MCP');
    if (custom) await click('Свой MCP');
    await until(`!!document.querySelector('[role="dialog"] .resource-row')`);
    await click('Добавить агенту');
    await click('Готово');
    await saved();
  };
  const openUnlink = async () => {
    await js(
      `Array.from(document.querySelectorAll('.resource-binding[data-removable]')).find(e=>e.querySelector('.ui-list-row-label').textContent==='team').querySelector('.hover-delete').focus({preventScroll:true})`,
    );
    await key('Enter', 'Enter', 13, '\r');
    await until(`!!document.querySelector('[role="alertdialog"]')`);
  };
  await select(0);
  await attach();
  assert.equal(await js(`document.querySelector('[data-builtin-mcp] .hover-delete')===null`), true);
  await select(1);
  await attach();
  await select(0);
  const firstBefore = await profile(first),
    secondBefore = await profile(second);
  const selected = await js(
    `document.querySelector('.agent-list-item[aria-current="true"]').getAttribute('aria-label')`,
  );
  await openUnlink();
  assert.ok(
    await js(
      `document.querySelector('[role="alertdialog"]').textContent.includes(${JSON.stringify(firstBefore.name)})`,
    ),
  );
  assert.ok(
    await js(`document.querySelector('[role="alertdialog"]').textContent.includes('team')`),
  );
  assert.deepEqual(await profile(first), firstBefore);
  await click('Отмена');
  assert.equal(
    await js(
      `document.querySelector('.agent-list-item[aria-current="true"]').getAttribute('aria-label')`,
    ),
    selected,
  );
  await openUnlink();
  await click('Удалить');
  await saved();
  await until(`document.querySelector('.toast')?.textContent.includes('Связь с ресурсом убрана')`);
  assert.deepEqual((await profile(first)).mcps, []);
  assert.deepEqual(await profile(second), secondBefore);
  // Add another link before Undo; only the removed stable ID may be restored.
  const custom = {
    id: 'qa-unlink-custom',
    name: 'QA unrelated MCP',
    kind: 'mcps',
    version: '1',
    source: 'https://example.invalid/mcp',
    transport: 'HTTP',
    args: '',
    credential: '',
    contents: '',
    description: 'QA only; no connection is made',
    createdAt: 1,
  };
  const state = await load();
  assert.equal(
    (
      await js(
        `window.studio.saveSection('resources',${JSON.stringify([...state.sections.resources, custom])},{folder:${JSON.stringify(state.folder)},base:${JSON.stringify(state.sections.resources)}})`,
      )
    ).saved,
    true,
  );
  await until(`!document.querySelector('.storage-error')`);
  await attach(true);
  await field('Название агента', firstBefore.name + ' updated');
  await saved();
  await select(1);
  await click('Вернуть');
  await saved();
  assert.deepEqual((await profile(first)).mcps, ['pistudio-team', custom.id]);
  assert.equal((await profile(first)).name, firstBefore.name + ' updated');
  assert.deepEqual(await profile(second), secondBefore);
  await select(0);
  refuseSaves(true);
  await openUnlink();
  await click('Удалить');
  await until(`document.querySelector('.toast')?.textContent.includes('Открепление не сохранено')`);
  assert.deepEqual((await profile(first)).mcps, ['pistudio-team', custom.id]);
  assert.ok(await js(`!!document.querySelector('.storage-error')`));
  refuseSaves(false);
  await click('Вернуть назначение');
  await saved();
  const assistant = initial.sections.systemAgents[0];
  await js(`document.querySelector('[data-system-role="assistant"] .agent-list-item').click()`);
  await click('MCP');
  await attach();
  await openUnlink();
  await click('Удалить');
  await saved();
  assert.deepEqual((await profile(assistant.id)).mcps, []);
  assert.equal(await js(`document.querySelector('[data-builtin-mcp] .hover-delete')===null`), true);
  const catalog = await js('window.studio.loadStudio()');
  await saved();
  window.webContents.reload();
  await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
  assert.deepEqual((await load()).sections.agentCatalog, catalog.sections.agentCatalog);
  assert.deepEqual((await profile(assistant.id)).mcps, []);
  return {
    keyboardConfirmationAndCancel: true,
    ordinaryAndSystemUnlinkPersisted: true,
    pinnedMcpProtected: true,
    undoPreservesLaterLinksAndNameAndOtherAgent: true,
    failedSaveHasNoSuccessAndRetainsNativeAssignment: true,
  };
};
