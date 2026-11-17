import { join } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { readImport } from '../teams/importState.ts';
import { atomicJson } from '../storage/files.ts';

/** A verified ready → broken transition permits a new explicit setup request, never an automatic send. */
export async function observeTeamMcpReadiness(
  service: StudioService,
  folder: string,
  packageId: string,
  ready: boolean,
) {
  await service.serialize(async () => {
    const store = await service.load();
    if (store.folder !== folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    const imported = await readImport(store, packageId);
    const report = imported.state.report;
    if (report.mcpReady === ready) return;
    if (report.mcpReady === true && !ready) report.mcpHandoff = 'pending';
    report.mcpReady = ready;
    await atomicJson(join(imported.root, 'state.json'), imported.state);
  });
}
