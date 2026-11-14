import type { PreparedRun } from './ContextBuilder.ts';
import type { ProjectActivity as Activity } from '../../shared/projectActivity.ts';

/** Confirmed runtime starts, distinct from opening Pi or admitting an input. */
export class ProjectActivity {
  private readonly active = new Map<string, { runId: string; projectId: string }>();
  set(run: PreparedRun, working: boolean) {
    const key = `${run.project.id}/${run.agent.profile.id}`;
    if (working) this.active.set(key, { runId: run.record.runId, projectId: run.project.id });
    else if (this.active.get(key)?.runId === run.record.runId) this.active.delete(key);
  }
  list(): Activity[] {
    const counts = new Map<string, number>();
    for (const item of this.active.values())
      counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
    return [...counts].map(([projectId, runningAgents]) => ({ projectId, runningAgents }));
  }
}
