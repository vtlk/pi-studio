import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { Eye, Pencil } from 'lucide-react';
import { useAgentProfiles } from '../model/AgentProfiles';
import { useLaunch } from '@/features/launch/model/Launch';
import { PromptPanel } from './PromptPanel';
import { InstructionsPanel } from './InstructionsPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { ModelPanel } from './ModelPanel';
import { Switch } from '@/shared/ui/SelectionControls';
export function AgentProfileEditor({
  agentId,
  inline = false,
}: {
  agentId?: string;
  inline?: boolean;
}) {
  useTranslation(undefined, { i18n });
  const { selectedAgent, updateAgent, agentTab, setAgentTab } = useAgentProfiles();
  const { setDialog } = useLaunch();
  const available = selectedAgent && (!agentId || selectedAgent.id === agentId);
  return (
    <section
      className={`agent-editor${inline ? ' project-inline-agent-settings' : ''}`}
      aria-label={
        inline ? t('AgentProfileEditor.agentSettings') : t('AgentProfileEditor.agentProfile')
      }
    >
      {available ? (
        <>
          <div className="agent-editor-header pane-toolbar">
            <label className="agent-name-editor">
              <input
                className="agent-name-input"
                aria-label={t('AgentProfileEditor.agentName')}
                autoFocus={inline}
                value={selectedAgent.name}
                onChange={(event) => updateAgent({ name: event.target.value })}
                placeholder={t('AgentProfileEditor.agentName')}
              />
              <Pencil size={17} aria-hidden="true" />
            </label>
            <label className="agent-enabled-control">
              <span>
                {selectedAgent.enabled ? t('AgentList.enabled') : t('AgentList.disabled')}
              </span>
              <Switch
                label={t('AgentProfileEditor.agentEnabled')}
                checked={selectedAgent.enabled}
                onChange={(enabled) => updateAgent({ enabled })}
              />
            </label>
          </div>
          <div className="agent-settings-layout">
            <SectionMenu
              label={t('AgentProfileEditor.agentSettings')}
              items={['Промпт', 'Инструкции', 'Skills', 'MCP', 'Плагины', 'Модель'].map(
                (label) => ({
                  id: label,
                  label:
                    label === 'Промпт'
                      ? t('AgentProfiles.prompt')
                      : label === 'Инструкции'
                        ? t('AgentProfileEditor.instructions')
                        : label === 'Плагины'
                          ? t('AgentProfileEditor.plugins')
                          : label === 'Модель'
                            ? t('AgentProfileEditor.model')
                            : label,
                }),
              )}
              selected={agentTab}
              onSelect={setAgentTab}
            />
            <div className="agent-settings-body">
              {agentTab === 'Промпт' ? (
                <PromptPanel />
              ) : agentTab === 'Инструкции' ? (
                <InstructionsPanel />
              ) : agentTab === 'Модель' ? (
                <ModelPanel />
              ) : (
                <CapabilitiesPanel />
              )}
              <div className="agent-editor-footer">
                <button
                  className="text-button"
                  onClick={() =>
                    setDialog({
                      title: t('AgentProfileEditor.whatTheAgentReceives'),
                      kind: 'prompt',
                    })
                  }
                >
                  <Eye size={14} />
                  {t('AgentProfileEditor.finalTask')}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="agent-editor-empty">
          {agentId
            ? t('AgentProfileEditor.theAgentProfileIsUnavailableNoOther')
            : t('AgentProfileEditor.addAnAgent')}
        </p>
      )}
    </section>
  );
}
