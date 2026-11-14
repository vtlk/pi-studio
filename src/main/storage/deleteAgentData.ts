import { lstat, mkdir, readdir } from 'node:fs/promises';
import type { StudioStore } from './StudioStore.ts';
import type { DeleteAgentDataRequest } from '../../shared/storage.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import { hasLiveSessionLease } from './sessionLease.ts';
import { isMissing, safePath } from './files.ts';
import { stableId } from './validation.ts';

/** Resolve only the selected agent's trusted folders; also used before stopping its idle Pi. */
export async function resolveAgentDataDeletion(
  store: StudioStore,
  request: DeleteAgentDataRequest,
) {
  if (!request || request.folder !== store.folder) throw new Error('Папка студии изменилась.');
  if (!['dialogue', 'files', 'all'].includes(request.target))
    throw new Error('Выберите, что удалить: диалог, файлы или всё.');
  const project = store.projects.list().find((item) => item.id === stableId(request.projectId));
  const agent = project?.agents.find((item) => item.profile.id === stableId(request.agentId));
  if (!project || !agent) throw new Error('Агент отсутствует в проекте.');
  const root = await store.projects.directory(project.id);
  const directory = agentDirectory(agent.outputPath);
  const paths = [
    ...(request.target !== 'dialogue' ? [agent.outputPath] : []),
    ...(request.target !== 'files' ? [`${directory}/sessions`] : []),
  ];
  // Validate both destinations before moving either; never follow a symlink.
  for (const path of paths) {
    const absolute = await safePath(root, path, true);
    try {
      if (!(await lstat(absolute)).isDirectory()) throw new Error('Ожидалась папка агента.');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return { project, agent, root, directory, paths };
}

export async function deleteAgentData(
  store: StudioStore,
  request: DeleteAgentDataRequest,
  trash: (path: string) => Promise<void>,
) {
  const { project, agent, root, directory, paths } = await resolveAgentDataDeletion(store, request);
  if (request.target !== 'files') {
    if (await hasLiveSessionLease(await safePath(root, directory)))
      throw new Error('Диалог ещё открыт в другом процессе Pi. Закройте его перед удалением.');
  }
  for (const path of paths) {
    const absolute = await safePath(root, path, true);
    let entries: string[];
    try {
      entries = await readdir(absolute);
    } catch (error) {
      if (!isMissing(error)) throw error;
      entries = [];
    }
    if (entries.length) await trash(absolute);
    await mkdir(await safePath(root, path, true), { recursive: true });
  }
  return request.target === 'files'
    ? store.projects.updateRuntime(project.id, agent.profile.id, 'idle')
    : store.projects.updateRuntime(project.id, agent.profile.id, 'idle', null);
}
