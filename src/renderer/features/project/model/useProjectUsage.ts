import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import type { WorkspaceProject } from '../../../../shared/project';

export function useProjectUsage(
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>,
  generation: MutableRefObject<number>,
) {
  useEffect(() => {
    if (!window.studio) return;
    let mounted = true,
      reading = false;
    const refresh = async () => {
      if (reading || document.hidden) return;
      reading = true;
      const version = generation.current;
      try {
        const rows = await getStudioApi().listProjectUsage();
        if (!mounted || generation.current !== version) return;
        const byId = new Map(rows.map((row) => [row.projectId, row]));
        setProjects((current) => {
          let changed = false;
          const next = current.map((project) => {
            const usage = byId.get(project.id);
            if (!usage) return project;
            if (
              JSON.stringify(project.usage) === JSON.stringify(usage.total) &&
              project.agents.every(
                (agent) =>
                  JSON.stringify(agent.usage) === JSON.stringify(usage.agents[agent.profile.id]),
              )
            )
              return project;
            changed = true;
            return {
              ...project,
              usage: usage.total,
              agents: project.agents.map((agent) => ({
                ...agent,
                usage: usage.agents[agent.profile.id],
              })),
            };
          });
          return changed ? next : current;
        });
      } catch {
        /* Keep the last confirmed totals; a renderer IPC failure cannot fabricate zero spend. */
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    const focused = () => {
      void refresh();
    };
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
    };
  }, [setProjects, generation]);
}
