import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { ProjectHeader } from './ProjectHeader';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { useWorkspace } from '../model/Workspace';
import type { WorkspaceProject } from '../model/workspace.types';
import { getAgentDisplayStatus, getAgentStatusLabel } from '../model/agentActivity';
import { AgentStatusIcon } from './AgentStatusIcon';
import { AgentActions } from './AgentActions';
import { AgentOutputsView } from './AgentOutputsView';
import { RefreshAgentsDialog } from './RefreshAgentsDialog';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { validateAgentModel } from '../../../../shared/modelConfiguration';
import { UsageMetrics } from './UsageMetrics';
import { usageAccessible } from '../model/usageFormat';
import { Switch } from '@/shared/ui/SelectionControls';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useChatPanels } from '@/features/chat/ChatPanels.context';
import { useNotice } from '@/shared/model/Notice';
import { uiText } from '@/shared/model/UiText';

function ProjectWorkspace({ project }: { project: WorkspaceProject }) {
  useTranslation(undefined, { i18n });
  const chats = useChatPanels();
  const { demo } = useNotice();
  const { setAutoContinue } = useWorkspace();
  const cancelChatSelection = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelChatSelection.current?.(), []);
  const { agents: profiles, setAgentId: selectProfile, setAgentTab } = useAgentProfiles();
  const { connections } = useConnections();
  const { ref, width } = useElementWidth();
  const [agentWidth, setAgentWidth] = useState(320);
  const [treeWidth, setTreeWidth] = useState(220);
  const maxAgentWidth = Math.max(200, (width || 1200) - 420);
  const actualAgentWidth = Math.min(agentWidth, maxAgentWidth);
  const [agentId, setAgentId] = useState(
    project.agents.find((agent) => agent.profile.enabled)?.profile.id ??
      project.agents[0]?.profile.id ??
      '',
  );
  const [refreshOpen, setRefreshOpen] = useState(false);
  const autoContinue = project.autoContinue === true;
  const [changingContinuation, setChangingContinuation] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const closeSettings = () => {
    setSettingsAgentId(null);
    chats.hide();
  };
  const openSettings = (id: string, tab?: string) => {
    chats.hide();
    selectProfile(id);
    if (tab) setAgentTab(tab);
    setAgentId(id);
    setSettingsAgentId(id);
  };
  const selectedAgent =
    project.agents.find(
      (agent) =>
        agent.profile.id ===
        (chats.target?.projectId === project.id ? chats.target.agentId : agentId),
    ) ?? project.agents[0];
  const changeContinuation = async (enabled: boolean) => {
    if (!selectedAgent || changingContinuation) return;
    setChangingContinuation(true);
    try {
      await window.studio?.setAutoContinuation({
        projectId: project.id,
        agentId: selectedAgent.profile.id,
        enabled,
      });
      setAutoContinue(enabled);
    } catch {
      demo(uiText('ProjectView.continuationChangeFailed'));
    } finally {
      setChangingContinuation(false);
    }
  };
  return (
    <div className="project-workspace">
      <ProjectHeader project={project} onRefresh={() => setRefreshOpen(true)} />
      <div
        className="project-files-layout"
        ref={ref}
        style={{ gridTemplateColumns: `${actualAgentWidth}px 8px minmax(0, 1fr)` }}
      >
        <aside className="project-agent-menu">
          <div className="project-column-heading project-agent-heading">
            <Tooltip label={t('ProjectView.projectAgents')} onlyWhenTruncated>
              <h2>{t('ProjectView.projectAgents')}</h2>
            </Tooltip>
            <Tooltip
              label={
                autoContinue
                  ? t('ProjectView.turnOffAutomaticContinuation')
                  : t('ProjectView.turnOnAutomaticContinuation')
              }
            >
              <span className="project-auto-continue">
                <Switch
                  checked={autoContinue}
                  onChange={(enabled) => void changeContinuation(enabled)}
                  disabled={!selectedAgent || changingContinuation}
                  label={t('ProjectView.automaticContinuationWhenLaunchingADialogue')}
                  trackIcon={
                    autoContinue ? (
                      <Play size={11} aria-hidden="true" />
                    ) : (
                      <Pause size={11} aria-hidden="true" />
                    )
                  }
                />
              </span>
            </Tooltip>
          </div>
          <SectionMenu
            label={t('ProjectView.projectAgents')}
            items={project.agents.map((agent, index) => {
              const modelConfigured = validateAgentModel(
                profiles.find((profile) => profile.id === agent.profile.id)?.model,
                connections,
              ).ok;
              const statusLabel = modelConfigured
                ? getAgentStatusLabel(agent)
                : t('ProjectView.noModelConnected');
              return {
                id: agent.profile.id,
                label: t('ProjectView.summary', {
                  value1: index + 1,
                  value2: agent.profile.name || t('AgentList.untitled'),
                }),
                muted: !agent.profile.enabled,
                icon: <AgentStatusIcon status={getAgentDisplayStatus(agent)} />,
                iconTooltip: statusLabel,
                ariaLabel: t('ProjectView.summary2', {
                  value1: index + 1,
                  value2: agent.profile.name || t('AgentList.untitled'),
                  value3: statusLabel,
                  value4: usageAccessible(agent.usage),
                }),
                description: <UsageMetrics usage={agent.usage} />,
                actions: (
                  <AgentActions
                    agent={agent}
                    modelConfigured={modelConfigured}
                    autoContinue={autoContinue}
                    onOpenSettings={openSettings}
                    onLaunch={() => {
                      closeSettings();
                      setAgentId(agent.profile.id);
                    }}
                  />
                ),
              };
            })}
            selected={selectedAgent?.profile.id ?? ''}
            onSelect={(id) => {
              closeSettings();
              setAgentId(id);
              cancelChatSelection.current?.();
              cancelChatSelection.current = chats.showRunning({
                projectId: project.id,
                agentId: id,
              });
            }}
          />
        </aside>
        <ResizeHandle
          label={t('ProjectView.agentColumnWidth')}
          value={actualAgentWidth}
          min={200}
          max={maxAgentWidth}
          onChange={setAgentWidth}
        />
        <section className="project-output-content" aria-label={t('ProjectView.agentResults')}>
          {selectedAgent ? (
            <AgentOutputsView
              key={`${project.id}:${selectedAgent.profile.id}`}
              agent={selectedAgent}
              settingsAgentId={
                settingsAgentId === selectedAgent.profile.id ? settingsAgentId : null
              }
              onCloseSettings={closeSettings}
              chatOpen={
                chats.target?.projectId === project.id &&
                chats.target.agentId === selectedAgent.profile.id
              }
              treeWidth={treeWidth}
              onTreeWidthChange={setTreeWidth}
            />
          ) : (
            <p>{t('ProjectView.theProjectSnapshotHasNoAgentsAdd')}</p>
          )}
        </section>
      </div>
      {refreshOpen && <RefreshAgentsDialog onClose={() => setRefreshOpen(false)} />}
    </div>
  );
}
export function ProjectView() {
  useTranslation(undefined, { i18n });
  const { selectedProject } = useWorkspace();
  return selectedProject ? (
    <ProjectWorkspace key={selectedProject.id} project={selectedProject} />
  ) : (
    <div className="page-body">{t('ProjectView.selectAProjectFromTheList')}</div>
  );
}
