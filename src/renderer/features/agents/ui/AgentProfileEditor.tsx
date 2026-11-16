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
  const { selectedAgent, updateAgent, agentTab, setAgentTab } = useAgentProfiles();
  const { setDialog } = useLaunch();
  const available = selectedAgent && (!agentId || selectedAgent.id === agentId);
  return (
    <section
      className={`agent-editor${inline ? ' project-inline-agent-settings' : ''}`}
      aria-label={inline ? 'Настройки агента' : 'Профиль агента'}
    >
      {available ? (
        <>
          <div className="agent-editor-header pane-toolbar">
            <label className="agent-name-editor">
              <input
                className="agent-name-input"
                aria-label="Название агента"
                autoFocus={inline}
                value={selectedAgent.name}
                onChange={(event) => updateAgent({ name: event.target.value })}
                placeholder="Название агента"
              />
              <Pencil size={17} aria-hidden="true" />
            </label>
            <label className="agent-enabled-control">
              <span>{selectedAgent.enabled ? 'Включён' : 'Выключен'}</span>
              <Switch
                label="Агент включён"
                checked={selectedAgent.enabled}
                onChange={(enabled) => updateAgent({ enabled })}
              />
            </label>
          </div>
          <div className="agent-settings-layout">
            <SectionMenu
              label="Настройки агента"
              items={['Промпт', 'Инструкции', 'Skills', 'MCP', 'Плагины', 'Модель'].map(
                (label) => ({
                  id: label,
                  label,
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
                  onClick={() => setDialog({ title: 'Что получит агент', kind: 'prompt' })}
                >
                  <Eye size={14} />
                  Итоговое задание
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="agent-editor-empty">
          {agentId
            ? 'Профиль агента недоступен. Другой профиль не подставляется.'
            : 'Добавьте агента.'}
        </p>
      )}
    </section>
  );
}
