import { t } from '../../shared/i18n/index.ts';
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
        try {
          const entries = await scanOutputs(root, projectAgentOutputPath(project, agent), {
            remaining: 5000,
            signal,
          });
          return { ...agent, session, entries, outputReadError: undefined };
        } catch (error) {
          signal?.throwIfAborted();
          return {
            ...agent,
            session,
            outputReadError:
              error instanceof Error
                ? error.message.slice(0, 500)
                : t('error.files.readingTheFolderOrFile'),
          };
        }
      }),
    ),
  };
}
