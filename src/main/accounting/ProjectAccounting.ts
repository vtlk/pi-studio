import { safePath } from '../storage/files.ts';
import type { WorkspaceProject } from '../../shared/project.ts';
import type { ProjectUsage } from '../../shared/projectUsage.ts';
import type { UsageRecord } from '../../shared/projectUsage.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import { UsageLedger } from './UsageLedger.ts';

/** One ledger per stable project, including archived IDs; filesystem moves keep their sidecars. */
export class ProjectAccounting {
  private readonly ledgers = new Map<string, UsageLedger>();
  private readonly unavailable = new Set<string>();
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  async reconcile(projects: WorkspaceProject[], trash: WorkspaceProject[], freshId?: string) {
    for (const [items, location] of [
      [projects, 'projects'],
      [trash, '.pistudio/trash'],
    ] as const) {
      for (const project of items) {
        const root = await safePath(this.root, `${location}/${project.folderName}`);
        const ids = [
          ...project.agents,
          ...(project.archivedAgents ?? []).map((item) => item.agent),
        ].map((agent) => agent.profile.id);
        let ledger = this.ledgers.get(project.id);
        try {
          if (!ledger) {
            ledger = new UsageLedger(root, project.id);
            await ledger.load(ids, project.id === freshId);
            this.ledgers.set(project.id, ledger);
          } else ledger.ensureAgents(ids);
          await ledger.relocate(root, project.id);
          if (!ledger.failed) await ledger.flush();
        } catch {
          this.unavailable.add(project.id);
        }
      }
    }
  }
  private ledger(run: PreparedRun) {
    const ledger = this.ledgers.get(run.project.id);
    if (!ledger || ledger.directory !== run.projectRoot)
      throw new Error('Учёт этого проекта ещё не загружен или папка изменилась.');
    return ledger;
  }
  async begin(run: PreparedRun) {
    try {
      await this.ledger(run).begin(run.agent.profile.id, run.record.runId);
    } catch {
      this.unavailable.add(run.project.id);
    } // Accounting never prevents the user's model request.
  }
  async record(run: PreparedRun, sample: unknown) {
    const ledger = this.ledger(run);
    try {
      await ledger.apply(run.agent.profile.id, run.record.runId, sample);
      this.unavailable.delete(run.project.id);
    } catch (error) {
      this.unavailable.add(run.project.id);
      throw error;
    }
  }
  async lost(run: PreparedRun) {
    const ledger = this.ledgers.get(run.project.id);
    if (!ledger || ledger.directory !== run.projectRoot) return;
    await ledger
      .lost(run.agent.profile.id, run.record.runId)
      .catch(() => this.unavailable.add(run.project.id));
  }
  async recover(projectId: string, agentId: string, records: UsageRecord[]) {
    const ledger = this.ledgers.get(projectId);
    if (!ledger || ledger.failed) return;
    for (let offset = 0; offset < records.length; offset += 500)
      await ledger.apply(agentId, undefined, { records: records.slice(offset, offset + 500) });
  }
  summary(id: string): ProjectUsage | undefined {
    const summary = this.ledgers.get(id)?.summary();
    if (summary && this.unavailable.has(id)) {
      for (const state of [summary.total, ...Object.values(summary.agents)]) {
        for (const value of [state.duration, ...Object.values(state.tokens)]) {
          value.partial = true;
          if (!value.value) value.value = null;
        }
        state.costPartial = true;
        if (!state.costObserved) state.costs = [];
        else for (const money of state.costs) money.partial = true;
      }
    }
    return summary;
  }
  enrich(project: WorkspaceProject): WorkspaceProject {
    const usage = this.summary(project.id);
    return {
      ...project,
      ...(usage ? { usage: usage.total } : {}),
      agents: project.agents.map((agent) => ({ ...agent, usage: usage?.agents[agent.profile.id] })),
    };
  }
  list(projects: WorkspaceProject[]) {
    return projects.flatMap((project) => {
      const usage = this.summary(project.id);
      return usage ? [usage] : [];
    });
  }
}
