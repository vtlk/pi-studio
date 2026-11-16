import { mkdir, lstat } from 'node:fs/promises';
import type { WorkspaceProject } from '../../shared/project.ts';
import {
  agentDirectory,
  agentRuntimeDirectory,
  agentSessionDirectory,
} from '../../shared/agentPaths.ts';
import { safePath, isMissing } from './files.ts';

export async function ensureProjectAgents(project: WorkspaceProject, root: string) {
  for (const agent of project.agents) {
    const legacy = await safePath(root, `${agentDirectory(agent.outputPath)}/sessions`, true);
    const legacyExists = await lstat(legacy).then(
      () => true,
      (error) => {
        if (isMissing(error)) return false;
        throw error;
      },
    );
    if (!legacyExists)
      await mkdir(await safePath(root, agentSessionDirectory(agent), true), { recursive: true });
    await mkdir(await safePath(root, agentRuntimeDirectory(agent), true), { recursive: true });
    if (project.workspaceMode !== 'shared')
      await mkdir(await safePath(root, agent.outputPath, true), { recursive: true });
  }
}
