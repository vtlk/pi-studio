import { agentName } from '@/shared/model/localizedProfiles';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/entities/studio/types';

export function AgentListLabel({ agent, position }: { agent: Agent; position: number }) {
  useTranslation(undefined, { i18n });
  return (
    <>
      <span className="agent-list-number" aria-hidden="true">
        {position}
      </span>
      <span className="section-menu-text">
        <span className="section-menu-label agent-list-name">
          {agentName(agent) || t('AgentList.untitled')}
        </span>
        <span className="section-menu-description">
          {agent.enabled ? t('AgentList.enabled') : t('AgentList.disabled')}
        </span>
      </span>
    </>
  );
}
