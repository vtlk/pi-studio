import { uiText } from '@/shared/model/UiText';
import { i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useResources } from '@/features/resources/model/Resources';
import { matchesLegacyTemplate } from '../model/legacyTemplates';

export function LegacyTemplateCleanup() {
  useTranslation(undefined, { i18n });
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
      const oldResources = resources.filter((_, index) => resourceMatches[index]);
      if (!oldAgents.length && !oldConnections.length && !oldResources.length) return;
      confirm({
        title: uiText('LegacyTemplateCleanup.removeSavedPrototypeTemplates'),
        description: uiText(
          'LegacyTemplateCleanup.unchangedExamplesFoundAgentsConnectionsResourcesRemove',
          { value1: oldAgents.length, value2: oldConnections.length, value3: oldResources.length },
        ),
        confirmLabel: uiText('LegacyTemplateCleanup.removeTemplates'),
        onConfirm: () => {
          oldAgents.forEach(({ agent }) => removeAgent(agent.id));
          oldConnections.forEach((connection) => removeConnection(connection.id));
          oldResources.forEach((resource) => removeResource(resource.kind, resource.id));
          demo(uiText('LegacyTemplateCleanup.prototypeTemplatesRemovedFromSharedSettings'), {
            label: uiText('useResourceUnlink.undo'),
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
        demo(uiText('LegacyTemplateCleanup.couldNotCheckPreviousTemplatesSavedData'));
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
