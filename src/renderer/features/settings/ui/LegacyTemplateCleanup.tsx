import { useEffect, useRef } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { exampleConnections, useConnections } from '@/features/connections/model/Connections';
import { exampleResources, useResources } from '@/features/resources/model/Resources';
import { initialAgents } from '@/fixtures/agents';
import { matchesTemplate } from '../model/legacyTemplates';

export function LegacyTemplateCleanup() {
  const { isDesktop } = useStorage();
  const { agents, removeAgent, restoreAgent } = useAgentProfiles();
  const { connections, removeConnection, saveConnection } = useConnections();
  const { resources, removeResource, saveResource } = useResources();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const reviewed = useRef(false);
  useEffect(() => {
    if (!isDesktop || reviewed.current) return;
    reviewed.current = true;
    const oldAgents = agents
      .map((agent, index) => ({ agent, index }))
      .filter(({ agent }) =>
        matchesTemplate(
          agent,
          initialAgents.find((item) => item.id === agent.id),
        ),
      );
    const oldConnections = connections.filter((connection) =>
      matchesTemplate(
        connection,
        exampleConnections.find((item) => item.id === connection.id),
      ),
    );
    const oldResources = resources.filter(
      (resource) =>
        matchesTemplate(
          resource,
          exampleResources.find((item) => item.id === resource.id && item.kind === resource.kind),
        ) ||
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
            oldAgents.forEach(({ agent, index }) => restoreAgent(agent, index));
            oldConnections.forEach(saveConnection);
            oldResources.forEach(saveResource);
          },
        });
      },
    });
  }, [
    isDesktop,
    agents,
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
