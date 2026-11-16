import { TeamMessages } from './TeamMessages';
import { useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui';
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
import { useConfirm } from '@/shared/model/Confirm';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { validateAgentModel } from '../../../../shared/modelConfiguration';
import { UsageMetrics } from './UsageMetrics';
import { usageAccessible } from '../model/usageFormat';
import { Switch } from '@/shared/ui/SelectionControls';
import { Tooltip } from '@/shared/ui/Tooltip';

function ProjectWorkspace({ project }: { project: WorkspaceProject }) {
  const { confirm } = useConfirm();
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
  const [autoContinue, setAutoContinue] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const closeSettings = () => setSettingsAgentId(null);
  const openSettings = (id: string, tab?: string) => {
    selectProfile(id);
    if (tab) setAgentTab(tab);
    setAgentId(id);
    setSettingsAgentId(id);
  };
  const selectedAgent =
    project.agents.find((agent) => agent.profile.id === agentId) ?? project.agents[0];
  return (
    <div className="project-workspace">
      <div className="project-header">
        <h1>{project.name}</h1>
        {window.studio && <TeamMessages project={project} />}
        <Button
          kind="primary"
          onClick={() =>
            confirm({
              title: 'Перечитать агентов?',
              description:
                'Сравнить проект с вкладкой «Агенты»? Отсутствующие в общем списке будут убраны из проекта, новые добавятся. Файлы и история Pi сохранятся. Изменения можно проверить перед применением.',
              confirmLabel: 'Перечитать',
              onConfirm: () => setRefreshOpen(true),
            })
          }
        >
          <RefreshCw size={17} />
          Перечитать агентов
        </Button>
      </div>
      <div
        className="project-files-layout"
        ref={ref}
        style={{ gridTemplateColumns: `${actualAgentWidth}px 8px minmax(0, 1fr)` }}
      >
        <aside className="project-agent-menu">
          <div className="project-column-heading project-agent-heading">
            <Tooltip label="Агенты проекта" onlyWhenTruncated>
              <h2>Агенты проекта</h2>
            </Tooltip>
            <Tooltip
              label={
                autoContinue
                  ? 'Выключить автоматическое продолжение'
                  : 'Включить автоматическое продолжение'
              }
            >
              <span className="project-auto-continue">
                <Switch
                  checked={autoContinue}
                  onChange={setAutoContinue}
                  label="Автоматическое продолжение при запуске диалога"
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
            label="Агенты проекта"
            items={project.agents.map((agent, index) => {
              const modelConfigured = validateAgentModel(
                profiles.find((profile) => profile.id === agent.profile.id)?.model,
                connections,
              ).ok;
              const statusLabel = modelConfigured
                ? getAgentStatusLabel(agent)
                : 'Не подключена модель';
              return {
                id: agent.profile.id,
                label: `${index + 1}. ${agent.profile.name || 'Без названия'}`,
                muted: !agent.profile.enabled,
                icon: <AgentStatusIcon status={getAgentDisplayStatus(agent)} />,
                iconTooltip: statusLabel,
                ariaLabel: `${index + 1}. ${agent.profile.name || 'Без названия'}. ${statusLabel}. ${usageAccessible(agent.usage)}`,
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
            }}
          />
        </aside>
        <ResizeHandle
          label="Ширина колонки агентов"
          value={actualAgentWidth}
          min={200}
          max={maxAgentWidth}
          onChange={setAgentWidth}
        />
        <section className="project-output-content" aria-label="Результаты агента">
          {selectedAgent ? (
            <AgentOutputsView
              key={`${project.id}:${selectedAgent.profile.id}`}
              agent={selectedAgent}
              settingsAgentId={
                settingsAgentId === selectedAgent.profile.id ? settingsAgentId : null
              }
              onCloseSettings={closeSettings}
              treeWidth={treeWidth}
              onTreeWidthChange={setTreeWidth}
            />
          ) : (
            <p>
              В снимке проекта нет агентов. Добавьте их на странице «Агенты» и нажмите «Перечитать
              агентов».
            </p>
          )}
        </section>
      </div>
      {refreshOpen && <RefreshAgentsDialog onClose={() => setRefreshOpen(false)} />}
    </div>
  );
}
export function ProjectView() {
  const { selectedProject } = useWorkspace();
  return selectedProject ? (
    <ProjectWorkspace key={selectedProject.id} project={selectedProject} />
  ) : (
    <div className="page-body">Выберите проект из списка.</div>
  );
}
