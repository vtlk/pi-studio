import { mkdir } from 'node:fs/promises';
import type { WorkspaceProject } from '../../shared/project.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import { safePath } from './files.ts';

export async function ensureProjectAgents(project: WorkspaceProject, root: string) {
  await mkdir(await safePath(root, 'agents', true), { recursive: true });
  for (const agent of project.agents)
    for (const sub of ['output', 'sessions'])
      await mkdir(await safePath(root, `${agentDirectory(agent.outputPath)}/${sub}`, true), {
        recursive: true,
      });
}
