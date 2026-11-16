import { hasBuiltinMcp } from '../../shared/builtinAssignments.ts';
import type { Agent } from '../../shared/studio.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { StudioService } from '../storage/StudioStore.ts';

/** Recheck saved assignments on every new call, including existing Pi transports. */
export function currentBuiltinAccess(
  service: StudioService,
  folder: string,
  agentId: string,
  resourceId: string,
) {
  return service.serialize(async () => {
    const store = await service.load();
    if (store.folder !== folder) return false;
    const sections = store.bootstrap().sections;
    const profile = [
      ...((sections.agents ?? []) as Agent[]),
      ...((sections.systemAgents ?? []) as SystemAgent[]),
    ].find((agent) => agent.id === agentId);
    return !!profile && hasBuiltinMcp(profile, resourceId);
  });
}
