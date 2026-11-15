import type { StudioService } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';
import { hasTeamMcp } from '../../shared/builtinResources.ts';
import type { TeamCaller } from './types.ts';

export async function projectCaller(
  service: StudioService,
  projectId: string,
  agentId?: string,
): Promise<TeamCaller> {
  stableId(projectId);
  return service.serialize(async () => {
    const store = await service.load();
    const project = await store.projects.read(projectId);
    const sender =
      project.agents.find((item) => item.profile.id === agentId) ??
      (!agentId ? project.agents[0] : undefined);
    if (agentId) {
      const current = store.agentCatalog().agents.find((item) => item.id === agentId);
      if (!sender || !current?.enabled || !hasTeamMcp(current))
        throw new Error('Отправитель удалён, выключен или MCP team отключён.');
    }
    return {
      project,
      projectRoot: await store.projects.directory(projectId),
      record: { projectId, agentId: sender?.profile.id ?? '' },
      teamAccess: true,
    };
  });
}
