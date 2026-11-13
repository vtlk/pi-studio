import { useEffect, useState } from 'react';
import type { WorkspaceProject } from './workspace.types';
import { countFiles } from './outputTree';

/** Read every displayed project's actual outputs, rather than treating an unloaded tree as empty. */
export function useProjectFileCounts(projects: WorkspaceProject[]) {
  const source = projects.map((project) => ({
    id: project.id,
    folder: project.folderName,
    files: project.agents.reduce((total, agent) => total + countFiles(agent.entries), 0),
  }));
  const signature = JSON.stringify(source);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!window.studio) return;
    const records = JSON.parse(signature) as { id: string }[];
    let active = true,
      reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const results = await Promise.allSettled(
          records.map((project) => window.studio!.readProject(project.id)),
        );
        if (active)
          setCounts(
            Object.fromEntries(
              results.map((result, index) => [
                records[index].id,
                result.status === 'fulfilled'
                  ? result.value.agents.reduce(
                      (total, agent) => total + countFiles(agent.entries),
                      0,
                    )
                  : null,
              ]),
            ),
          );
      } finally {
        reading = false;
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [signature]);
  return window.studio
    ? counts
    : Object.fromEntries(source.map((project) => [project.id, project.files]));
}
