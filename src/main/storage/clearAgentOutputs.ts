import { lstat, mkdir, readdir } from 'node:fs/promises';
import type { StudioStore } from './StudioStore.ts';
import type { ClearAgentOutputRequest } from '../../shared/storage.ts';
import { safePath } from './files.ts';
import { stableId } from './validation.ts';

/** Move the trusted output directory to macOS Trash, never the agent/session directory. */
export async function clearAgentOutputs(
  store: StudioStore,
  request: ClearAgentOutputRequest,
  trash: (path: string) => Promise<void>,
) {
  if (!request || request.folder !== store.folder) throw new Error('Папка студии изменилась.');
  const project = store.projects.list().find((item) => item.id === stableId(request.projectId));
  const agent = project?.agents.find((item) => item.profile.id === stableId(request.agentId));
  if (!project || !agent) throw new Error('Агент отсутствует в проекте.');
  const root = await store.projects.directory(project.id);
  const output = await safePath(root, agent.outputPath);
  if (!(await lstat(output)).isDirectory()) throw new Error('Папка результатов отсутствует.');
  if ((await readdir(output)).length) {
    await trash(output);
    await mkdir(await safePath(root, agent.outputPath, true));
  }
  return store.projects.updateRuntime(project.id, agent.profile.id, 'idle');
}
