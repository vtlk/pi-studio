import { SectionMenu } from '@/shared/ui/SectionMenu';
import { Eye, Pencil } from 'lucide-react';
import { useAgentProfiles } from '../model/AgentProfiles';
import { useLaunch } from '@/features/launch/model/Launch';
import { InstructionsPanel } from './InstructionsPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { ModelPanel } from './ModelPanel';
import { AgentList } from './AgentList';
import { Switch } from '@/shared/ui/SelectionControls';
export function AgentsView() {
  const { selectedAgent, updateAgent, agentTab, setAgentTab } = useAgentProfiles();
  const { setDialog } = useLaunch();
  return (
    <div className="agents-workspace">
      <aside className="agent-stages">
        <AgentList />
      </aside>
      <section className="agent-editor" aria-label="Профиль агента">
        {selectedAgent ? (
          <>
            <div className="agent-editor-header">
              <label className="agent-name-editor">
                <input
                  className="agent-name-input"
                  aria-label="Название агента"
                  value={selectedAgent.name}
                  onChange={(event) => updateAgent({ name: event.target.value })}
                  placeholder="Название агента"
                />
                <Pencil size={17} aria-hidden="true" />
              </label>
              <label className="agent-enabled-control">
                <span>{selectedAgent.enabled ? 'Включён' : 'Выключен'}</span>
                <Switch
                  size="large"
                  label="Агент включён"
                  checked={selectedAgent.enabled}
                  onChange={(enabled) => updateAgent({ enabled })}
                />
              </label>
            </div>
            <div className="agent-settings-layout">
              <SectionMenu
                label="Настройки агента"
                items={['Инструкции', 'Skills', 'MCP', 'Плагины', 'Модель'].map((label) => ({
                  id: label,
                  label,
                }))}
                selected={agentTab}
                onSelect={setAgentTab}
              />
              <div className="agent-settings-body">
                {agentTab === 'Инструкции' ? (
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
          <p>Добавьте агента.</p>
        )}
      </section>
    </div>
  );
}
