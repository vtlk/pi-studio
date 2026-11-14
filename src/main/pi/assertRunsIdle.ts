import type { LiveRun } from './RunTypes.ts';

export function assertRunsIdle(
  changing: ReadonlySet<string>,
  opening: ReadonlySet<string>,
  retiring: Iterable<string>,
  live: Iterable<LiveRun>,
  projectId?: string,
) {
  if (
    (projectId ? changing.has(projectId) : changing.size > 0) ||
    opening.size ||
    [...retiring].some((key) => !projectId || key.startsWith(`${projectId}/`)) ||
    [...live].some(
      (run) => (!projectId || run.run.record.projectId === projectId) && run.status === 'running',
    )
  )
    throw new Error(
      'Дождитесь завершения или остановите работающий Pi перед изменением папки проекта/студии.',
    );
}
