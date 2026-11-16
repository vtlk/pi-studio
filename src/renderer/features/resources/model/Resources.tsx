import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useStoredState } from '@/shared/storage/Storage';
import { useContext, type ReactNode } from 'react';
import type { CapabilityKind, Agent } from '@/entities/studio/types';
import { ResourcesContext } from './Resources.context';

import type { Resource } from '../../../../shared/resources';
export type { Resource } from '../../../../shared/resources';
export const resourceLabels = (): Record<CapabilityKind, string> => ({
  skills: 'Skills',
  mcps: 'MCP',
  plugins: t('AgentProfileEditor.plugins'),
});
function useResourcesState(initial: Resource[]) {
  useTranslation(undefined, { i18n });
  const [resources, setResources] = useStoredState<Resource[]>('resources', initial);
  return {
    resources,
    saveResource: (resource: Resource) =>
      setResources((previous) =>
        [
          resource,
          ...previous.filter((item) => item.id !== resource.id || item.kind !== resource.kind),
        ].sort((a, b) => b.createdAt - a.createdAt),
      ),
    removeResource: (kind: CapabilityKind, id: string) =>
      setResources((previous) => previous.filter((item) => item.kind !== kind || item.id !== id)),
  };
}
export type ResourcesValue = ReturnType<typeof useResourcesState>;
export function ResourcesProvider({
  children,
  initial = [],
}: {
  children: ReactNode;
  initial?: Resource[];
}) {
  useTranslation(undefined, { i18n });
  return (
    <ResourcesContext.Provider value={useResourcesState(initial)}>
      {children}
    </ResourcesContext.Provider>
  );
}
export function useResources() {
  useTranslation(undefined, { i18n });
  const value = useContext(ResourcesContext);
  if (!value) throw new Error('ResourcesProvider is missing');
  return value;
}
export function enabledResources(agent: Agent, kind: CapabilityKind) {
  return agent[kind].filter((id) => agent.capabilitySettings?.[`${kind}:${id}`]?.enabled !== false);
}
