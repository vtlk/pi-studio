import type { Agent } from '@/entities/studio/types';

export function AgentListLabel({ agent, position }: { agent: Agent; position: number }) {
  return (
    <>
      <span className="agent-list-number" aria-hidden="true">
        {position}
      </span>
      <span className="section-menu-text">
        <span className="section-menu-label agent-list-name">{agent.name || 'Без названия'}</span>
        <span className="section-menu-description">{agent.enabled ? 'Включён' : 'Выключен'}</span>
      </span>
    </>
  );
}
