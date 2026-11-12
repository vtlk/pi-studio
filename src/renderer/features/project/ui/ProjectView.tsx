import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { useWorkspace } from '../model/Workspace';
import type { WorkspaceProject } from '../model/workspace.types';
import { agentStatusLabels, getAgentDisplayStatus } from '../model/agentActivity';
import { AgentStatusIcon } from './AgentStatusIcon';
import { AgentOutputsView } from './AgentOutputsView';
import { RefreshAgentsDialog } from './RefreshAgentsDialog';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { useConfirm } from '@/shared/model/Confirm';

function ProjectWorkspace({ project }: { project: WorkspaceProject }) {
  const { confirm } = useConfirm();
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
  const selectedAgent =
    project.agents.find((agent) => agent.profile.id === agentId) ?? project.agents[0];
  return (
    <div className="project-workspace">
      <div className="project-header">
        <h1>{project.name}</h1>
        <Button
          onClick={() =>
            confirm({
              title: 'Перечитать агентов?',
              description:
                'Сравнить снимок проекта с текущим списком агентов? Выходные файлы сохранятся. Изменения можно проверить перед применением.',
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
          <SectionMenu
            label="Агенты проекта"
            items={project.agents.map((agent, index) => ({
              id: agent.profile.id,
              label: `${index + 1}. ${agent.profile.name || 'Без названия'}`,
              muted: !agent.profile.enabled,
              tooltip: `${agent.profile.name || 'Без названия'} · ${agentStatusLabels[getAgentDisplayStatus(agent)]}${project.id === 'demo-project' ? ' (пример статуса)' : ''}`,
              suffix: <AgentStatusIcon status={getAgentDisplayStatus(agent)} />,
            }))}
            selected={selectedAgent?.profile.id ?? ''}
            onSelect={setAgentId}
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
