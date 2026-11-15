import { useEffect, useRef } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useResources } from '@/features/resources/model/Resources';
import { matchesLegacyTemplate } from '../model/legacyTemplates';

export function LegacyTemplateCleanup() {
  const { isDesktop } = useStorage();
  const { agents, teams, removeAgent, restoreAgent } = useAgentProfiles();
  const { connections, removeConnection, saveConnection } = useConnections();
  const { resources, removeResource, saveResource } = useResources();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const reviewed = useRef(false);
  useEffect(() => {
    if (!isDesktop || reviewed.current) return;
    let disposed = false;
    const review = async () => {
      const agentMatches = await Promise.all(
        agents.map((agent) => matchesLegacyTemplate(agent, 'agents')),
      );
      const connectionMatches = await Promise.all(
        connections.map((connection) => matchesLegacyTemplate(connection, 'connections')),
      );
      const resourceMatches = await Promise.all(
        resources.map((resource) => matchesLegacyTemplate(resource, 'resources')),
      );
      if (disposed) return;
      reviewed.current = true;
      const oldAgents = agents
        .map((agent) => {
          const team = teams.find((team) => team.agentIds.includes(agent.id));
          return { agent, index: team?.agentIds.indexOf(agent.id) ?? 0, teamId: team?.id ?? '' };
        })
        .filter((_, index) => agentMatches[index]);
      const oldConnections = connections.filter((_, index) => connectionMatches[index]);
      const oldResources = resources.filter(
        (resource, index) =>
          resourceMatches[index] ||
          (resource.createdAt === 0 &&
            resource.kind === 'skills' &&
            resource.source.includes('/.pistudio/packages/pi-studio-library/skills/')),
      );
      if (!oldAgents.length && !oldConnections.length && !oldResources.length) return;
      confirm({
        title: 'Убрать сохранённые шаблоны макета?',
        description: `Найдены неизменённые примеры: агенты — ${oldAgents.length}, подключения — ${oldConnections.length}, ресурсы — ${oldResources.length}. Убрать их из общих настроек? Пользовательские правки, проекты, их снимки агентов и исходные файлы сохранятся.`,
        confirmLabel: 'Убрать шаблоны',
        onConfirm: () => {
          oldAgents.forEach(({ agent }) => removeAgent(agent.id));
          oldConnections.forEach((connection) => removeConnection(connection.id));
          oldResources.forEach((resource) => removeResource(resource.kind, resource.id));
          demo('Шаблоны макета убраны из общих настроек.', {
            label: 'Вернуть',
            onClick: () => {
              oldAgents.forEach(({ agent, index, teamId }) => restoreAgent(agent, index, teamId));
              oldConnections.forEach(saveConnection);
              oldResources.forEach(saveResource);
            },
          });
        },
      });
    };
    void review().catch(() => {
      if (!disposed) {
        reviewed.current = true;
        demo('Не удалось проверить прежние шаблоны. Сохранённые данные не изменены.');
      }
    });
    return () => {
      disposed = true;
    };
  }, [
    isDesktop,
    agents,
    teams,
    connections,
    resources,
    confirm,
    demo,
    removeAgent,
    restoreAgent,
    removeConnection,
    saveConnection,
    removeResource,
    saveResource,
  ]);
  return null;
}
