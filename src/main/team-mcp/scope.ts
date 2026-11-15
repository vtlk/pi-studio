import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller } from './types.ts';
import type { ProjectAgent } from '../../shared/project.ts';
import type { Connection } from '../../shared/connections.ts';
import type { Resource } from '../../shared/resources.ts';

export async function teamScope(service: StudioService, run: TeamCaller) {
  return service.serialize(async () => {
    const store = await service.load();
    const project = await store.projects.read(run.project.id);
    const root = await store.projects.directory(project.id);
    if (
      root !== run.projectRoot ||
      !project.agents.some((item) => item.profile.id === run.record.agentId)
    )
      throw new Error('Привязка team к проекту/агенту изменилась. Откройте диалог через Studio.');
    const catalog = store.agentCatalog();
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
export function outputAgent(scope: TeamScope, id: unknown): ProjectAgent {
  if (typeof id !== 'string') throw new Error('Нужен стабильный agent_id.');
  const agent = [
    ...scope.project.agents,
    ...(scope.project.archivedAgents ?? []).map((item) => item.agent),
  ].find((item) => item.profile.id === id);
  if (!agent) throw new Error('Агент отсутствует в этом проекте. Другой проект не подставляется.');
  return agent;
}
export function recipient(scope: TeamScope, args: Record<string, unknown>) {
  if (!scope.team) throw new Error('Исходная команда удалена; отправка недоступна.');
  const members = scope.catalog.agents.filter((item) => scope.team!.agentIds.includes(item.id));
  const matches =
    args.agent_id !== undefined
      ? members.filter((item) => item.id === args.agent_id)
      : members.filter((item) => item.name === args.agent_name);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Неоднозначное имя. Укажите agent_id: ${matches.map((item) => item.id).join(', ')}`
        : 'Получатель отсутствует в исходной команде.',
    );
  const current = matches[0];
  const saved = scope.project.agents.find((item) => item.profile.id === current.id);
  if (!saved) throw new Error('Агент ещё не в проекте. Нажмите «Перечитать агентов».');
  if (!current.enabled || !saved.profile.enabled) throw new Error('Получатель выключен.');
  return { current, saved };
}
