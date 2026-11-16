import { join } from 'node:path';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import { safePath } from '../storage/files.ts';
import { readNativeUsage } from './readNativeUsage.ts';

/** Backfill numeric usage from canonical Pi entries, without opening a model/runtime. */
export class UsageRecovery {
  private readonly attempted = new Set<string>();
  private readonly abort = new AbortController();
  private pending = Promise.resolve();
  private held = false;
  private readonly service: StudioService;
  private readonly script: string;
  private readonly piPath: () => string;
  constructor(service: StudioService, script: string, piPath: () => string) {
    this.service = service;
    this.script = script;
    this.piPath = piPath;
  }
  schedule(store: StudioStore) {
    const pi = String(store.bootstrap().sections.piPath || this.piPath());
    if (!pi || this.abort.signal.aborted || this.held) return;
    for (const project of store.projects.list()) {
      const root = join(store.folder, 'projects', project.folderName!);
      for (const agent of [
        ...project.agents,
        ...(project.archivedAgents ?? []).map((item) => item.agent),
      ]) {
        if (!agent.session || agent.session.missing) continue;
        const path = agent.session.path;
        const key = JSON.stringify([root, agent.profile.id, path]);
        if (this.attempted.has(key)) continue;
        this.attempted.add(key);
        this.pending = this.pending
          .then(async () => {
            const file = await safePath(root, path);
            const records = await readNativeUsage(pi, this.script, file, root, this.abort.signal);
            await this.service.serialize(async () => {
              const current = await this.service.load();
              if (current !== store || this.abort.signal.aborted) return;
              const saved = current.projects.list().find((item) => item.id === project.id);
              const sameAgent = [
                ...(saved?.agents ?? []),
                ...(saved?.archivedAgents ?? []).map((item) => item.agent),
              ].find((item) => item.profile.id === agent.profile.id);
              if (
                !saved ||
                saved.folderName !== project.folderName ||
                sameAgent?.session?.path !== path
              )
                return;
              await current.accounting.recover(project.id, agent.profile.id, records);
            });
          })
          .catch(() => {}); // Missing/unsupported history must never prevent a launch.
      }
    }
  }
  close() {
    this.abort.abort();
  }
  hold() {
    if (this.held) throw new Error('Учёт уже приостановлен для обновления.');
    this.held = true;
    let released = false;
    return {
      release: () => {
        if (!released) {
          released = true;
          this.held = false;
        }
      },
    };
  }
  flush() {
    return this.pending;
  }
}
