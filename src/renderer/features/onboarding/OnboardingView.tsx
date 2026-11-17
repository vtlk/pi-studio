import { Circle, Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { t, i18n } from '../../../shared/i18n';
import { validateAgentModel } from '../../../shared/modelConfiguration';
import { useOnboarding } from './Onboarding';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useTeamTransfers } from '@/features/agents/model/TeamTransfers';
import { useResources } from '@/features/resources/model/Resources';
import { ResourceActions } from '@/features/resources/ui/ResourceActions';
import { useNavigation } from '@/shared/model/Navigation';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Tooltip } from '@/shared/ui/Tooltip';
import { SetupAssistantError } from '@/features/setup-assistant/ui/SetupAssistantError';
import { useState } from 'react';
import { agentName } from '@/shared/model/localizedProfiles';
import './onboarding.css';

export function OnboardingView() {
  useTranslation(undefined, { i18n });
  const { tasks } = useOnboarding();
  const { teams, systemAgents, setAgentId, setAgentTab } = useAgentProfiles();
  const { connections } = useConnections();
  const { resources } = useResources();
  const transfers = useTeamTransfers();
  const { navigate, openSettings } = useNavigation();
  const [resourceId, setResourceId] = useState('');
  const resource = resources.find((item) => item.id === resourceId);
  const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
  const assistantReady =
    !!assistant?.enabled && validateAgentModel(assistant.model, connections).ok;
  const openModel = (id: string) => {
    setAgentId(id);
    setAgentTab('Модель');
    navigate('agents');
  };
  return (
    <section className="onboarding-page" aria-labelledby="onboarding-heading">
      <div className="onboarding-content">
        <h1 id="onboarding-heading">{t('Onboarding.title')}</h1>
        <ul className="onboarding-list" aria-label={t('Onboarding.tasks')}>
          {tasks.map((task) => {
            const systemAgent = systemAgents.find((agent) => agent.id === task.agentId);
            const name = systemAgent ? agentName(systemAgent) : task.name;
            const label =
              task.kind === 'connection'
                ? t('Onboarding.connection')
                : task.kind === 'agent-model'
                  ? t('Onboarding.agent', { name })
                  : task.kind === 'mcp-auth'
                    ? t('Onboarding.mcpAuth', { name: task.name })
                    : t('Onboarding.mcpCheck', { name: task.name });
            return (
              <li key={task.id} data-complete={task.complete} data-task-id={task.id}>
                <span
                  className="onboarding-status"
                  aria-label={task.complete ? t('Onboarding.complete') : t('Onboarding.pending')}
                >
                  {task.complete ? (
                    <Check size={23} aria-hidden="true" />
                  ) : (
                    <Circle size={36} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </span>
                <div className="onboarding-task-content">
                  <span className="onboarding-task-label">{label}</span>
                </div>
                {!task.complete && (
                  <div className="onboarding-task-actions">
                    <Button
                      onClick={() => {
                        if (task.kind === 'connection') openSettings('connections');
                        else if (task.agentId) openModel(task.agentId);
                        else if (resources.some((item) => item.id === task.resourceId))
                          setResourceId(task.resourceId!);
                        else openSettings('mcps');
                      }}
                    >
                      {t('Onboarding.configure')}
                    </Button>
                    {(task.teamIds ?? []).map((teamId) => {
                      const report = transfers.reports.find((report) => report.teamId === teamId);
                      const team = teams.find((team) => team.id === teamId);
                      if (!report || !team) return null;
                      return (
                        <Tooltip
                          key={teamId}
                          label={t('Onboarding.assistant', { name: team.name })}
                        >
                          <Button
                            className="onboarding-assistant"
                            disabled={transfers.busy || !transfers.available || !assistant}
                            busy={transfers.busy}
                            onClick={() =>
                              assistantReady
                                ? void transfers.continueImport(report.id)
                                : assistant && openModel(assistant.id)
                            }
                          >
                            {transfers.busy && (
                              <LoaderCircle
                                size={17}
                                className="onboarding-spinner"
                                aria-hidden="true"
                              />
                            )}
                            {t('Onboarding.withAssistant')}
                          </Button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <SetupAssistantError error={transfers.error} onClose={transfers.clearError} />
      {resource && (
        <Modal
          title={resource.name}
          onClose={() => setResourceId('')}
          footer={<Button onClick={() => setResourceId('')}>{t('TeamTransfers.close')}</Button>}
        >
          <p>{t('Onboarding.resourceDescription')}</p>
          <ResourceActions resource={resource} />
        </Modal>
      )}
    </section>
  );
}
