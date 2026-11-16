import { uiText } from '@/shared/model/UiText';
import { agentTabLabel, agentName } from '@/shared/model/localizedProfiles';
import { resourceLabel, resourceVersion } from '@/shared/model/localizedResources';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AddArea } from '@/shared/ui/AddArea';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { useResourceUnlink } from '../model/useResourceUnlink';
import { useResources } from '@/features/resources/model/Resources';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import { useAgentProfiles } from '../model/AgentProfiles';
import { resourceStatus } from '@/features/resources/model/resourceStatus';
import { builtinResource } from '../../../../shared/builtinResources';
import { McpPicker } from './McpPicker';
import { BrowserResourceStatus } from '@/features/resources/ui/BrowserResourceStatus';
import { ComputerResourceStatus } from '@/features/resources/ui/ComputerResourceStatus';
import { requiredBuiltinMcpIds } from '../../../../shared/builtinAssignments.ts';

export function CapabilitiesPanel() {
  useTranslation(undefined, { i18n });
  const { agentTab, selectedAgent, selectedSystemRole, updateAgent } = useAgentProfiles();
  const { resources } = useResources();
  const { busy, unlink } = useResourceUnlink();
  const [catalog, setCatalog] = useState(false);
  if (!selectedAgent) return null;
  const field = agentTab === 'Skills' ? 'skills' : agentTab === 'MCP' ? 'mcps' : 'plugins';
  const required = requiredBuiltinMcpIds({ systemRole: selectedSystemRole });
  const links =
    field === 'mcps' ? [...new Set([...required, ...selectedAgent.mcps])] : selectedAgent[field];
  return (
    <div className="agent-settings-content">
      {!selectedAgent[field].length && field !== 'mcps' && (
        <p>{t('CapabilitiesPanel.noResourcesAssignedChooseThemFromThe')}</p>
      )}
      <DisclosureList>
        {links.map((id) => {
          const key = `${field}:${id}`;
          const locked = field === 'mcps' && required.includes(id);
          const resource =
            field === 'mcps' && builtinResource(id)
              ? builtinResource(id)
              : resources.find((item) => item.kind === field && item.id === id);
          const binding = selectedAgent.capabilitySettings?.[key] ?? { enabled: true };
          const updateBinding = (update: Partial<typeof binding>) =>
            updateAgent({
              capabilitySettings: {
                ...selectedAgent.capabilitySettings,
                [key]: { ...binding, ...update },
              },
            });
          return (
            <div
              className="resource-binding"
              key={id}
              data-removable={!locked || undefined}
              data-builtin-mcp={!!builtinResource(id) || undefined}
            >
              <Disclosure
                label={resourceLabel(resource, 'name') ?? id}
                locked={
                  locked ? t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved') : undefined
                }
                reserveActions
                toggle={
                  locked
                    ? undefined
                    : {
                        checked: binding.enabled,
                        label: t('CapabilitiesPanel.use', { value1: id }),
                        onChange: (enabled) => updateBinding({ enabled }),
                      }
                }
                actions={
                  locked ? undefined : (
                    <HoverDeleteButton
                      label={
                        field === 'mcps'
                          ? uiText('CapabilitiesPanel.unlinkMcp')
                          : uiText('CapabilitiesPanel.removeFromTheAgent', { value1: id })
                      }
                      confirmationTitle={
                        field === 'mcps'
                          ? uiText('CapabilitiesPanel.unlinkMcpFromAgent', {
                              value1: resourceLabel(resource, 'name') ?? id,
                              value2: agentName(selectedAgent),
                            })
                          : undefined
                      }
                      disabled={busy}
                      description={uiText('CapabilitiesPanel.onlyThisAgentSAssignmentIsRemoved')}
                      onDelete={() => void unlink(field, id)}
                    />
                  )
                }
              >
                <p>
                  {resourceLabel(resource, 'description') ??
                    t('CapabilitiesPanel.thisResourceIsMissingFromTheShared')}
                </p>
                <p className="subtle">
                  {resource
                    ? resource.source.startsWith('builtin:')
                      ? t('CapabilitiesPanel.builtInConnectsTheNextTimePi')
                      : `${resource.version ? `${resourceVersion(resource)} · ` : ''}${resourceStatus(resource, !!window.studio)}`
                    : t('CapabilitiesPanel.unavailable')}
                </p>
                {id === 'pistudio-browser' && <BrowserResourceStatus />}
                {id === 'pistudio-computer' && <ComputerResourceStatus />}
              </Disclosure>
            </div>
          );
        })}
      </DisclosureList>
      <AddArea
        label={t('CapabilitiesPanel.add', { value1: agentTabLabel(agentTab) })}
        onClick={() => setCatalog(true)}
      />
      {catalog && (
        <Modal
          size="wide"
          title={t('CapabilitiesPanel.sharedCatalog', { value1: agentTabLabel(agentTab) })}
          onClose={() => setCatalog(false)}
          footer={<Button onClick={() => setCatalog(false)}>{t('CapabilitiesPanel.done')}</Button>}
        >
          {field === 'mcps' ? (
            <McpPicker
              attached={links}
              onPick={(id) => updateAgent({ mcps: [...selectedAgent.mcps, id] })}
            />
          ) : (
            <ResourceCatalog
              kind={field}
              attached={selectedAgent[field]}
              onPick={(id) => updateAgent({ [field]: [id, ...selectedAgent[field]] })}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
