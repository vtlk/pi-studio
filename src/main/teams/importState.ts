import { t } from '../../shared/i18n/index.ts';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { StudioStore } from '../storage/StudioStore.ts';
import { safePath, readJson, isMissing } from '../storage/files.ts';
import { record, stableId } from '../storage/validation.ts';
import type { ImportedTeamState } from './importTeam.ts';
import { decodePackage, packageLimit } from './packageCodec.ts';
import { describeMcpAuthorization } from '../../shared/mcpAuthorization.ts';

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
    (report.mcpHandoff !== undefined &&
      !['pending', 'sending', 'sent', 'uncertain'].includes(String(report.mcpHandoff))) ||
    !['pending', 'sending', 'sent', 'uncertain'].includes(String(report.handoff))
  )
    throw new Error(t('error.importState.theTeamImportIsMissing'));
  const file = await safePath(root, 'package.pistudio-team');
  if ((await lstat(file)).size > packageLimit)
    throw new Error(t('error.importState.teamPackageTooLarge'));
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
    throw new Error(t('error.importState.importedPackageReferencesAreInvalid'));
  // Derive links from validated package mappings, including packages written before Onboarding.
  state.report.teamName = store.agentCatalog().teams.find((team) => team.id === teamId)!.name;
  state.report.requiresImages = data.manifest.tools?.images === true;
  state.report.mcps = data.manifest.resources
    .filter((resource) => resource.kind === 'mcps')
    .map((resource) => {
      const inferred = describeMcpAuthorization(resource.mcp ?? {});
      return {
        resourceId: state.resourceMap[resource.id],
        name: resource.name,
        authorization: resource.source.startsWith('builtin:')
          ? { required: 'no' as const, methods: [], fields: [] }
          : inferred.required === 'yes'
            ? inferred
            : (resource.authorization ?? inferred),
      };
    });
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
