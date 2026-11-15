import { join } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { StudioResources } from '../pi/StudioResources.ts';
import type { Connection } from '../../shared/connections.ts';
import { resolveAgentLaunchConfig } from '../pi/resolveAgentLaunchConfig.ts';
import { TeamImportTools } from './TeamImportTools.ts';

export function createTeamImportTools(
  service: StudioService,
  resources: StudioResources,
  options: { userData: string; bridgeDirectory: string; piPath: () => string },
) {
  return new TeamImportTools(service, resources, async (agent, store) => {
    const sections = store.bootstrap().sections;
    await resolveAgentLaunchConfig(agent.model, (sections.connections ?? []) as Connection[], {
      folder: store.folder,
      piPath: String(sections.piPath ?? '') || options.piPath(),
      bootstraps: join(options.userData, 'setup-bootstraps'),
      catalog: join(options.bridgeDirectory, 'catalog.mjs'),
    });
  });
}
