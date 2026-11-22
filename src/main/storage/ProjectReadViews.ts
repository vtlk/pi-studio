import type { WorkspaceProject } from '../../shared/project.ts';
import { readProject } from './readProject.ts';

/** File trees are presentation snapshots, never part of a status/handshake write. */
export class ProjectReadViews {
  private readonly views = new Map<string, WorkspaceProject>();
  private outputRevision = 0;
  snapshot(project: WorkspaceProject, previous = this.views.get(project.id)): WorkspaceProject {
    const compatible =
      previous?.folderName === project.folderName &&
      previous?.workspaceMode === project.workspaceMode;
    return {
      ...project,
      agents: project.agents.map((agent) => {
        const previousAgent = compatible
          ? previous?.agents.find(
              (item) =>
                item.profile.id === agent.profile.id && item.outputPath === agent.outputPath,
            )
          : undefined;
        return {
          ...agent,
          entries: previousAgent?.entries ?? agent.entries,
          outputReadError: previousAgent?.outputReadError,
        };
      }),
    };
  }
  clearOutputs(project: WorkspaceProject, agentId: string) {
    this.outputRevision++;
    const cached = this.views.get(project.id);
    if (!cached) return;
    this.views.set(project.id, {
      ...cached,
      agents: cached.agents.map((agent) =>
        project.workspaceMode === 'shared' || agent.profile.id === agentId
          ? { ...agent, entries: [], outputReadError: undefined }
          : agent,
      ),
    });
  }
  async read(
    project: WorkspaceProject,
    root: string,
    current: () => WorkspaceProject,
    signal?: AbortSignal,
  ) {
    const revision = this.outputRevision;
    const files = await readProject(this.snapshot(project), root, signal);
    signal?.throwIfAborted();
    // A walk that started before a clear cannot repopulate the cleared view.
    if (revision !== this.outputRevision) return this.snapshot(current());
    const view = this.snapshot(current(), files);
    this.views.set(view.id, view);
    if (this.views.size > 8) this.views.delete(this.views.keys().next().value!);
    return view;
  }
}
