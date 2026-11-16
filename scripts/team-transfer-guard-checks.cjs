const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({
  js,
  until,
  click,
  saved,
  load,
  openTeamMenu,
  chooseTeamAction,
  packagePath,
  studio,
  root,
  saveCalls,
  blockSave,
}) => {
  const initial = await load();
  const originalTeams = initial.sections.agentTeams;
  await click('Агенты');
  await openTeamMenu(originalTeams[0].id);
  await chooseTeamAction('Импорт команды');
  await until(
    `document.querySelector('[role="dialog"]')?.textContent.includes('Сначала настройте подключение Агента')`,
  );
  const imported = await load();
  assert.equal(imported.sections.agentTeams.length, originalTeams.length + 1);
  for (const team of originalTeams)
    assert.deepEqual(
      imported.sections.agentTeams.find((item) => item.id === team.id),
      team,
    );
  assert.deepEqual(
    imported.sections.agents.filter((agent) =>
      initial.sections.agents.some((old) => old.id === agent.id),
    ),
    initial.sections.agents,
  );
  const reports = await js(`window.studio.listTeamImports(${JSON.stringify(studio)})`);
  assert.equal(reports.length, 2);
  assert.ok(reports.every((report) => report.handoff === 'pending'));
  await click('Отмена');
  await saved();

  // Exercise main's revalidation after the native picker against the real IPC handlers.
  const before = await readFile(packagePath);
  const id = originalTeams[0].id;
  const startExport = async () => {
    const beforeCount = saveCalls();
    const release = blockSave();
    await js(
      `window.__teamGuard = undefined; window.studio.exportAgentTeam({folder:${JSON.stringify(studio)},teamId:${JSON.stringify(id)}}).then(value=>{window.__teamGuard={value}},error=>{window.__teamGuard={error:error.message}}); true`,
    );
    for (let i = 0; i < 100 && saveCalls() === beforeCount; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(saveCalls(), beforeCount + 1, 'Main reached the controlled native picker');
    return release;
  };
  let release = await startExport();
  const catalog = imported.sections.agentCatalog;
  const removed = {
    teams: catalog.teams.filter((team) => team.id !== id),
    agents: catalog.agents.filter((agent) => !originalTeams[0].agentIds.includes(agent.id)),
  };
  const save = (value, base) =>
    js(
      `window.studio.saveSection('agentCatalog',${JSON.stringify(value)},{folder:${JSON.stringify(studio)},base:${JSON.stringify(base)}})`,
    );
  assert.equal((await save(removed, catalog)).saved, true);
  release();
  await until(`!!window.__teamGuard`);
  assert.match(await js(`window.__teamGuard.error`), /команд[аы].*отсутствует/i);
  assert.deepEqual(await readFile(packagePath), before);
  assert.equal((await save(catalog, removed)).saved, true);

  release = await startExport();
  const other = join(root, 'Other studio');
  await js(`window.studio.openStudio(${JSON.stringify(other)})`);
  release();
  await until(`!!window.__teamGuard`);
  assert.match(await js(`window.__teamGuard.error`), /Папка студии изменилась/);
  assert.deepEqual(await readFile(packagePath), before);
  await js(`window.studio.openStudio(${JSON.stringify(studio)})`);
  assert.deepEqual((await load()).sections.agentCatalog, catalog);
  await saved();
  return {
    rowImportCreatesNewTeamPreservesOriginals: true,
    sharedPendingReportsWithoutDuplicateHandoff: true,
    removedTeamDuringPickerRefused: true,
    studioChangeDuringPickerRefused: true,
    staleExportsNeverWriteFile: true,
  };
};
