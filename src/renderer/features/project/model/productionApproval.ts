import type { WorkspaceProject } from './workspace.types';
import { listOutputFiles } from './outputTree.ts';
export function scenePreviewStatus(project: WorkspaceProject) {
  const files = project.agents
    .flatMap((agent) => listOutputFiles(agent.entries).map((item) => item.file))
    .filter((file) => file.name === 'сцена.svg');
  const accepted = files.filter((file) => {
    const review = project.reviews?.[file.id];
    return review && review.acceptedRevision === review.revision;
  }).length;
  return { total: files.length, accepted, ready: files.length > 0 && accepted === files.length };
}
