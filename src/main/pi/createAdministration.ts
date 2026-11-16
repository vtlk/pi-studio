import { dirname, join } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { TeamImportTools } from '../teams/TeamImportTools.ts';
import { SetupAdministration } from './SetupAdministration.ts';
import { StudioResources } from './StudioResources.ts';
import { readPiCatalog } from './catalog.ts';

export interface AdministrationOptions {
  catalog: string;
  piPath: () => string;
  resources?: StudioResources;
  mcpSecrets?: McpSecrets;
  teamImports?: TeamImportTools;
}

export function createAdministration(service: StudioService, options: AdministrationOptions) {
  return new SetupAdministration(
    service,
    async () => {
      const location = await service.serialize(async () => {
        const store = await service.load();
        return {
          folder: store.folder,
          piPath: String(store.bootstrap().sections.piPath ?? '') || options.piPath(),
        };
      });
      return readPiCatalog(location.piPath, options.catalog, location.folder);
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
