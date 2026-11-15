import type { WorkspaceProject } from '../../shared/project.ts';
import { atomicJson, safePath } from './files.ts';
import { projectDocument } from './validation.ts';

/** Resumable metadata-only transition. Paths, profiles and canonical histories stay in place. */
export async function migrateProjectTeams(
  root: string,
  projects: Map<string, WorkspaceProject>,
  trash: Map<string, WorkspaceProject>,
  teamId: string,
) {
  for (const [items, prefix] of [
    [projects, 'projects'],
    [trash, '.pistudio/trash'],
  ] as const) {
    for (const [id, project] of items) {
      if (project.sourceTeamId !== undefined) continue;
      const next = { ...project, sourceTeamId: teamId };
      await atomicJson(
        await safePath(root, `${prefix}/${project.folderName}/project.json`),
        projectDocument(next),
      );
      items.set(id, next);
    }
  }
}
