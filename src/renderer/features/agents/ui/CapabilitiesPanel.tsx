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
import { BrowserResourceRow } from '@/features/resources/ui/BrowserResourceRow';
import { ComputerResourceRow } from '@/features/resources/ui/ComputerResourceRow';

export function CapabilitiesPanel() {
  useTranslation(undefined, { i18n });
  const { agentTab, selectedAgent, selectedSystemRole, updateAgent } = useAgentProfiles();
  const { resources } = useResources();
  const { busy, unlink } = useResourceUnlink();
  const [catalog, setCatalog] = useState(false);
  if (!selectedAgent) return null;
  const field = agentTab === 'Skills' ? 'skills' : agentTab === 'MCP' ? 'mcps' : 'plugins';
  return (
    <div className="agent-settings-content">
      {!selectedAgent[field].length && field !== 'mcps' && (
        <p>{t('CapabilitiesPanel.noResourcesAssignedChooseThemFromThe')}</p>
      )}
      <DisclosureList>
        {field === 'mcps' && (
          <div className="resource-binding" data-builtin-mcp>
            <Disclosure
              label={
                selectedSystemRole
                  ? t('builtin.administration.name')
                  : t('CapabilitiesPanel.piStudioProject')
              }
              locked={t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved')}
              reserveActions
            >
              <p>
                {selectedSystemRole
                  ? t('builtin.assistant.description')
                  : t('CapabilitiesPanel.currentProjectContextFileReadingWebSearch')}
              </p>
              <p className="subtle">
                {t('CapabilitiesPanel.requiredBuiltInMcpDisablingAndRemoval')}
              </p>
              <p className="subtle">
                {selectedSystemRole === 'assistant'
                  ? t('CapabilitiesPanel.connectsWhenTheAssistantStarts')
                  : t('CapabilitiesPanel.connectsWhenAProjectAgentStarts')}
              </p>
              {selectedSystemRole !== 'assistant' && (
                <p className="subtle">{t('CapabilitiesPanel.theSharedImageToolUsesTheApi')}</p>
              )}
            </Disclosure>
          </div>
        )}
        {field === 'mcps' && <BrowserResourceRow />}
        {field === 'mcps' && <ComputerResourceRow />}
        {selectedAgent[field].map((id) => {
          const key = `${field}:${id}`;
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
            <div className="resource-binding" key={id} data-removable>
              <Disclosure
                label={resourceLabel(resource, 'name') ?? id}
                toggle={{
                  checked: binding.enabled,
                  label: t('CapabilitiesPanel.use', { value1: id }),
                  onChange: (enabled) => updateBinding({ enabled }),
                }}
                actions={
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
              attached={selectedAgent.mcps}
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
