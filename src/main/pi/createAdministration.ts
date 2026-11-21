import { dirname, join } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { TeamImportTools } from '../teams/TeamImportTools.ts';
import { SetupAdministration } from './SetupAdministration.ts';
import { StudioResources } from './StudioResources.ts';
import { readPiCatalog } from './catalog.ts';
import { t } from '../../shared/i18n/index.ts';
import { connectionAuthScope } from './modelAuth.ts';

export interface AdministrationOptions {
  catalog: string;
  bootstraps: string;
  piPath: () => string;
  resources?: StudioResources;
  mcpSecrets?: McpSecrets;
  teamImports?: TeamImportTools;
}

export function createAdministration(service: StudioService, options: AdministrationOptions) {
  return new SetupAdministration(
    service,
    async (connection, expectedFolder) => {
      const location = await service.serialize(async () => {
        const store = await service.load();
        if (expectedFolder !== undefined && store.folder !== expectedFolder)
          throw Error(t('SettingsRead.changed'));
        return {
          folder: store.folder,
          piPath: String(store.bootstrap().sections.piPath ?? '') || options.piPath(),
        };
      });
      const scope =
        connection &&
        (await connectionAuthScope(
          join(dirname(options.bootstraps), 'model-auth'),
          location.folder,
          connection,
        ));
      return readPiCatalog(location.piPath, options.catalog, location.folder, scope);
    },
    options.resources ??
      new StudioResources(service, {
        script: join(dirname(options.catalog), 'resources.mjs'),
        piPath: options.piPath,
        mcpSecrets: options.mcpSecrets,
      }),
    options.teamImports,
  );
}
