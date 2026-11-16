const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { gunzipSync } = require('node:zlib');
module.exports = async ({
  js,
  until,
  click,
  field,
  saved,
  load,
  openTeamMenu,
  chooseTeamAction,
  packagePath,
  cancelPicker,
  refuseSaves,
  blockSave,
  saveCalls,
}) => {
  const initial = await load(),
    teams = initial.sections.agentTeams;
  const selected = await js(
    `document.querySelector('.agent-list-item[aria-current="true"]').getAttribute('aria-label')`,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.agent-team > .disclosure > .ui-list-row .hover-delete').length`,
    ),
    0,
  );
  const rename = async (id, name) => {
    await js(
      `document.querySelector('[data-team-id="'+${JSON.stringify(id)}+'"] .team-rename').click()`,
    );
    await field('Название команды', name);
    await click('Сохранить');
    await saved();
  };
  const clearToast = () =>
    js(`document.querySelector('[aria-label="Скрыть уведомление"]')?.click()`);
  for (const team of teams) await rename(team.id, 'Одинаковое имя');
  for (const team of teams) {
    const row = `[data-team-id="${team.id}"]`;
    await js(`document.querySelector(${JSON.stringify(row + ' .disclosure-trigger')}).click()`);
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(row + ' .disclosure-content')}).hidden`),
      true,
    );
    await clearToast();
    await openTeamMenu(team.id);
    await chooseTeamAction('Экспорт команды');
    await until(`document.querySelector('.toast')?.textContent.includes('Пакет сохранён')`);
    const packet = JSON.parse(gunzipSync(await readFile(packagePath)).toString());
    assert.equal(packet.manifest.team.name, 'Одинаковое имя');
    assert.deepEqual(
      packet.manifest.agents.map((a) => a.name),
      team.agentIds.map((id) => initial.sections.agents.find((a) => a.id === id).name),
    );
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(row + ' .disclosure-content')}).hidden`),
      true,
      'Menu never toggles disclosure',
    );
    assert.equal(
      await js(
        `document.querySelector('.agent-list-item[aria-current="true"]').getAttribute('aria-label')`,
      ),
      selected,
    );
    await js(`document.querySelector(${JSON.stringify(row + ' .disclosure-trigger')}).click()`);
  }
  for (const team of teams) await rename(team.id, team.name);
  const beforeCancel = await readFile(packagePath),
    catalog = (await load()).sections.agentCatalog;
  cancelPicker(true);
  await clearToast();
  await openTeamMenu(teams[0].id);
  await chooseTeamAction('Экспорт команды');
  await until(`!document.querySelector('.team-actions-menu:disabled')`);
  assert.deepEqual(await readFile(packagePath), beforeCancel);
  await openTeamMenu(teams[0].id);
  await chooseTeamAction('Импорт команды');
  await until(`!document.querySelector('.team-actions-menu:disabled')`);
  assert.deepEqual((await load()).sections.agentCatalog, catalog);
  cancelPicker(false);
  await writeFile(packagePath, 'not a portable package');
  await clearToast();
  await openTeamMenu(teams[0].id);
  await chooseTeamAction('Импорт команды');
  await until(`document.querySelector('.toast')?.textContent.includes('Пакет команды не принят')`);
  assert.deepEqual((await load()).sections.agentCatalog, catalog);
  await writeFile(packagePath, beforeCancel);
  const originalAgentName = await js(
    `document.querySelector('[aria-label="Название агента"]').value`,
  );
  refuseSaves(true);
  await field('Название агента', originalAgentName + ' — not saved');
  await until(`!!document.querySelector('.storage-error')`);
  const saveCountBefore = saveCalls();
  await clearToast();
  await openTeamMenu(teams[0].id);
  await chooseTeamAction('Экспорт команды');
  await until(`document.querySelector('.toast')?.textContent.includes('Дождитесь сохранения')`);
  assert.equal(saveCalls(), saveCountBefore, 'Save refusal prevents opening native picker');
  assert.deepEqual((await load()).sections.agentCatalog, catalog);
  refuseSaves(false);
  await field('Название агента', originalAgentName);
  await saved();
  const release = blockSave(),
    count = saveCalls();
  await openTeamMenu(teams[0].id);
  await chooseTeamAction('Экспорт команды');
  assert.equal(saveCalls(), count + 1);
  await until(`!!document.querySelector('.team-actions-menu:disabled')`);
  await click('Настройки');
  await click('Команды агентов');
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Импорт команды агентов').disabled`,
    ),
    true,
  );
  await click('Импорт команды агентов');
  assert.deepEqual((await load()).sections.agentCatalog, catalog);
  release();
  await until(
    `!Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Импорт команды агентов').disabled`,
  );
  assert.equal(
    saveCalls(),
    count + 1,
    'Settings did not start a duplicate transfer while menu operation was busy',
  );
  return {
    duplicateNamesExportExactStableTeam: true,
    collapsedRowAndSelectionPreserved: true,
    cancelledRowPickersPreserveCatalogAndFile: true,
    invalidRowImportPreservesCatalog: true,
    globalBusyAcrossMenuAndSettings: true,
    saveRefusalPreventsPicker: true,
  };
};
