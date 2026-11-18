import type { WorkspaceProject } from '../../shared/project.ts';
import { projectAgentOutputPath } from '../../shared/agentPaths.ts';
import { safePath } from './files.ts';
import { scanOutputs } from './outputs.ts';

export async function readProject(
  project: WorkspaceProject,
  root: string,
  signal?: AbortSignal,
): Promise<WorkspaceProject> {
  return {
    ...project,
    agents: await Promise.all(
      project.agents.map(async (agent) => {
        let session = agent.session;
        if (session) {
          try {
            await safePath(root, session.path);
          } catch {
            session = { ...session, missing: true };
          }
        }
        return {
          ...agent,
          session,
          entries: await scanOutputs(root, projectAgentOutputPath(project, agent), {
            remaining: 5000,
            signal,
          }),
        };
      }),
    ),
  };
}
