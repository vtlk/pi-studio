import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { StudioStore } from '../storage/StudioStore.ts';
import { safePath, readJson, isMissing } from '../storage/files.ts';
import { record, stableId } from '../storage/validation.ts';
import type { ImportedTeamState } from './importTeam.ts';
import { decodePackage, packageLimit } from './packageCodec.ts';

export async function readImport(store: StudioStore, id: string) {
  stableId(id);
  const root = await safePath(store.folder, `.pistudio/team-imports/${id}`);
  const state = record(
    await readJson(await safePath(root, 'state.json')),
  ) as unknown as ImportedTeamState;
  const report = record(state.report),
    teamId = stableId(report.teamId);
  if (
    report.id !== id ||
    !store.agentCatalog().teams.some((team) => team.id === teamId) ||
    !Array.isArray(report.agents) ||
    !['pending', 'sending', 'sent', 'uncertain'].includes(String(report.handoff))
  )
    throw new Error('Импорт команды отсутствует или его команда удалена.');
  const file = await safePath(root, 'package.pistudio-team');
  if ((await lstat(file)).size > packageLimit) throw new Error('Слишком большой пакет команды.');
  const data = decodePackage(await readFile(file));
  const mappings = [
    ...Object.values(record(state.agentMap)),
    ...Object.values(record(state.resourceMap)),
  ];
  mappings.forEach(stableId);
  if (
    Object.keys(state.agentMap).some(
      (id) => !data.manifest.agents.some((agent) => agent.id === id),
    ) ||
    Object.keys(state.resourceMap).some(
      (id) => !data.manifest.resources.some((resource) => resource.id === id),
    )
  )
    throw new Error('Нарушены связи импортированного пакета.');
  return { root, state, data };
}
export async function listImports(store: StudioStore) {
  const root = await safePath(store.folder, '.pistudio/team-imports', true);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = await safePath(root, join(entry.name, 'state.json'));
    const state = record(await readJson(file));
    const report = record(state.report);
    if (!store.agentCatalog().teams.some((team) => team.id === report.teamId)) continue;
    reports.push((await readImport(store, entry.name)).state.report);
  }
  return reports.sort((a, b) => b.createdAt - a.createdAt);
}
