import { t } from '../../shared/i18n/index.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller } from './types.ts';
import type { ProjectAgent } from '../../shared/project.ts';
import type { Connection } from '../../shared/connections.ts';
import type { Resource } from '../../shared/resources.ts';
import { hasTeamMcp } from '../../shared/builtinResources.ts';

export async function teamScope(service: StudioService, run: TeamCaller) {
  return service.serialize(async () => {
    const store = await service.load();
    const project = store.projects.snapshot(run.project.id);
    const root = await store.projects.directory(project.id);
    if (
      root !== run.projectRoot ||
      !project.agents.some((item) => item.profile.id === run.record.agentId)
    )
      throw new Error(t('error.scope.theTeamBindingToThe'));
    const catalog = store.agentCatalog();
    const sender = catalog.agents.find((agent) => agent.id === run.record.agentId);
    // Open transports retain their schema; authority always comes from current saved assignments.
    if (!sender?.enabled || !hasTeamMcp(sender))
      throw new Error(t('error.scope.mcpTeamIsDisabledOr'));
    const team = catalog.teams.find((item) => item.id === project.sourceTeamId);
    const sections = store.bootstrap().sections;
    return {
      project,
      root,
      team,
      catalog,
      folder: store.folder,
      resources: (sections.resources ?? []) as Resource[],
      connections: (sections.connections ?? []) as Connection[],
    };
  });
}
export type TeamScope = Awaited<ReturnType<typeof teamScope>>;
export function isEarlierStage(scope: TeamScope, senderId: string, recipientId: string) {
  const order = scope.project.agents;
  const sender = order.findIndex((item) => item.profile.id === senderId && item.profile.enabled);
  const target = order.findIndex((item) => item.profile.id === recipientId && item.profile.enabled);
  return !!scope.team?.agentIds.includes(senderId) && target >= 0 && target < sender;
}
export function outputAgent(scope: TeamScope, id: unknown): ProjectAgent {
  if (typeof id !== 'string') throw new Error(t('error.scope.aStableAgentIdIs'));
  const agent = [
    ...scope.project.agents,
    ...(scope.project.archivedAgents ?? []).map((item) => item.agent),
  ].find((item) => item.profile.id === id);
  if (!agent) throw new Error(t('error.scope.theAgentIsMissingFrom'));
  return agent;
}
export function recipient(scope: TeamScope, args: Record<string, unknown>) {
  if (!scope.team) throw new Error(t('error.scope.theSourceTeamWasDeleted'));
  const members = scope.catalog.agents.filter((item) => scope.team!.agentIds.includes(item.id));
  const matches =
    args.agent_id !== undefined
      ? members.filter((item) => item.id === args.agent_id)
      : members.filter((item) => item.name === args.agent_name);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? t('error.scope.ambiguousNameSpecifyAgentId', {
            value1: matches.map((item) => item.id).join(', '),
          })
        : t('error.scope.theRecipientIsMissingFrom'),
    );
  const current = matches[0];
  const saved = scope.project.agents.find((item) => item.profile.id === current.id);
  if (!saved) throw new Error(t('error.scope.theAgentIsNotIn'));
  if (!current.enabled || !saved.profile.enabled)
    throw new Error(t('error.scope.recipientDisabled'));
  return { current, saved };
}
