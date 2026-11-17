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
import { builtinResource } from '../../../shared/builtinResources';
import type { OnboardingTask } from '../../../shared/onboarding';
import type { Connection } from '../../../shared/connections';
import { ConnectionEditor } from '@/features/connections/ui/ConnectionEditor';
import { TeamNameDialog } from '@/features/agents/ui/TeamNameDialog';
import { ComputerResourceStatus } from '@/features/resources/ui/ComputerResourceStatus';
import { BrowserResourceStatus } from '@/features/resources/ui/BrowserResourceStatus';
import { useLaunch } from '@/features/launch/model/Launch';
import { Select } from '@/shared/ui/Select';
import { agentName } from '@/shared/model/localizedProfiles';
import { resourceLabel } from '@/shared/model/localizedResources';
import './onboarding.css';

export function OnboardingView() {
  useTranslation(undefined, { i18n });
  const { tasks, readiness } = useOnboarding();
  const { teams, systemAgents, setAgentId, setAgentTab, addTeam, addAgent } = useAgentProfiles();
  const { connections } = useConnections();
  const { resources } = useResources();
  const transfers = useTeamTransfers();
  const { navigate, openSettings } = useNavigation();
  const [resourceId, setResourceId] = useState('');
  const [connection, setConnection] = useState<Connection>();
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [choosingTeam, setChoosingTeam] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [actionError, setActionError] = useState('');
  const { setDialog } = useLaunch();
  const refresh = () => window.dispatchEvent(new Event('pistudio:onboarding-refresh'));
  const closeResource = () => {
    setResourceId('');
    refresh();
  };
  const configure = (task: OnboardingTask) => {
    if (task.kind === 'readiness-check') {
      refresh();
      return;
    }
    if (task.kind === 'terminal') {
      void window.studio
        ?.openTerminalDownload()
        .catch(() => setActionError(t('Onboarding.terminalDownloadFailed')));
      return;
    }
    if (task.kind === 'git') {
      void window.studio
        ?.openGitDownload()
        .catch(() => setActionError(t('Onboarding.gitDownloadFailed')));
      return;
    }
    if (task.kind === 'create-team') {
      setCreatingTeam(true);
      return;
    }
    if (task.kind === 'create-agent') {
      if (teams.length === 1) {
        addAgent(teams[0].id);
        navigate('agents');
      } else if (!teams.length) setCreatingTeam(true);
      else setChoosingTeam(true);
      return;
    }
    if (task.kind === 'create-project') {
      setDialog({ title: t('NewProjectDialog.createProject'), kind: 'new-project' });
      return;
    }
    if (task.connectionId) {
      setConnection(connections.find((connection) => connection.id === task.connectionId));
      return;
    }
    if (task.kind === 'connection' || task.kind === 'images') {
      openSettings('connections');
      return;
    }
    if (task.agentId) {
      openModel(task.agentId);
      return;
    }
    if (task.resourceId) setResourceId(task.resourceId);
  };
  const taskLabel = (task: OnboardingTask, name: string) => {
    const keys = {
      connection: 'Onboarding.connection',
      'connection-auth': 'Onboarding.connectionAuth',
      'connection-check': 'Onboarding.connectionCheck',
      'agent-model': 'Onboarding.agent',
      'mcp-auth': 'Onboarding.mcpAuth',
      'mcp-check': 'Onboarding.mcpCheck',
      'mcp-install': 'Onboarding.mcpInstall',
      computer: 'Onboarding.computer',
      browser: 'Onboarding.browser',
      images: 'Onboarding.images',
      terminal: 'Onboarding.terminal',
      git: 'Onboarding.git',
      'create-team': 'Onboarding.createTeam',
      'create-agent': 'Onboarding.createAgent',
      'create-project': 'Onboarding.createProject',
      'readiness-check': 'Onboarding.readinessCheck',
    } as const;
    return t(keys[task.kind], { name });
  };
  const resource = resources.find((item) => item.id === resourceId) ?? builtinResource(resourceId);
  const assistant = systemAgents.find((agent) => agent.systemRole === 'assistant');
  const assistantModelReady =
    !!assistant?.enabled && validateAgentModel(assistant.model, connections).ok;
  const assistantReady =
    assistantModelReady && readiness?.connections[assistant?.model?.connectionId ?? ''] === 'ready';
  const openTeamSetup = (id: string) => {
    if (!assistant) return;
    if (!assistantModelReady) {
      openModel(assistant.id);
      return;
    }
    if (!assistantReady) {
      const connection = connections.find((item) => item.id === assistant.model?.connectionId);
      if (connection) setConnection(connection);
      else openModel(assistant.id);
      return;
    }
    void transfers.continueImport(id);
  };
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
            const label = taskLabel(task, name);
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
                    <Button onClick={() => configure(task)}>
                      {task.kind.startsWith('create-')
                        ? t('TeamNameDialog.create')
                        : t('Onboarding.configure')}
                    </Button>
                    {task.kind === 'create-team' && (
                      <Button
                        disabled={transfers.busy || !transfers.available}
                        onClick={() => void transfers.importTeam()}
                      >
                        {t('AgentList.importTeam')}
                      </Button>
                    )}
                    {(task.kind.startsWith('mcp-') ? (task.teamIds ?? []) : []).map((teamId) => {
                      const report = transfers.reports.find((report) => report.teamId === teamId);
                      const team = teams.find((team) => team.id === teamId);
                      if (!report || !team) return null;
                      return (
                        <Tooltip
                          key={teamId}
                          label={
                            readiness?.terminal === 'missing'
                              ? t('Onboarding.terminal')
                              : t('Onboarding.assistant', { name: team.name })
                          }
                        >
                          <Button
                            className="onboarding-assistant"
                            disabled={
                              transfers.busy ||
                              !transfers.available ||
                              !assistant ||
                              (!!readiness && readiness.terminal !== 'ready')
                            }
                            busy={transfers.busy}
                            onClick={() => openTeamSetup(report.id)}
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
      {creatingTeam && (
        <TeamNameDialog
          onClose={() => setCreatingTeam(false)}
          onSave={(name, mode) => addTeam(name, mode)}
        />
      )}
      {choosingTeam && (
        <Modal
          title={t('Onboarding.createAgent')}
          onClose={() => setChoosingTeam(false)}
          footer={
            <Button
              disabled={!teams.some((team) => team.id === teamId)}
              onClick={() => {
                addAgent(teamId);
                setChoosingTeam(false);
                navigate('agents');
              }}
            >
              {t('TeamNameDialog.create')}
            </Button>
          }
        >
          <Select
            label={t('NewProjectDialog.agentTeam')}
            value={teamId}
            onValueChange={setTeamId}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            placeholder={t('TeamTransferPanel.selectATeam')}
          />
        </Modal>
      )}
      {connection && (
        <ConnectionEditor
          connection={connection}
          onClose={() => {
            setConnection(undefined);
            refresh();
          }}
        />
      )}
      {actionError && (
        <Modal
          alert
          title={t('TeamTransfers.theOperationDidNotComplete')}
          onClose={() => setActionError('')}
          footer={<Button onClick={() => setActionError('')}>{t('TeamTransfers.close')}</Button>}
        >
          <p>{actionError}</p>
        </Modal>
      )}
      {resource && (
        <Modal
          title={resourceLabel(resource, 'name')}
          onClose={closeResource}
          footer={<Button onClick={closeResource}>{t('TeamTransfers.close')}</Button>}
        >
          {resource.source === 'builtin:computer' ? (
            <ComputerResourceStatus />
          ) : resource.source === 'builtin:browser' ? (
            <BrowserResourceStatus />
          ) : (
            <>
              <p>{t('Onboarding.resourceDescription')}</p>
              <ResourceActions resource={resource} />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
