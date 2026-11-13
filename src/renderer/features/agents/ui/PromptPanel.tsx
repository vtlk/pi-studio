import { useAgentProfiles } from '../model/AgentProfiles';

export function PromptPanel() {
  const { selectedAgent, updateAgent } = useAgentProfiles();
  if (!selectedAgent) return null;
  return (
    <div className="agent-prompt-panel">
      <label className="field-label">
        Основной промпт агента
        <textarea
          value={selectedAgent.mainInstruction ?? ''}
          onChange={(event) => updateAgent({ mainInstruction: event.target.value })}
          placeholder="Задание и правила работы агента"
        />
      </label>
    </div>
  );
}
