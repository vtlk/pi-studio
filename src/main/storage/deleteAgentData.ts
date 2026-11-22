import { t } from '../../shared/i18n/index.ts';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import type { StudioStore } from './StudioStore.ts';
import type { DeleteAgentDataRequest } from '../../shared/storage.ts';
import {
  agentRuntimeDirectory,
  agentSessionDirectory,
  isSharedTaskPath,
} from '../../shared/agentPaths.ts';
import {
  hasLiveSessionLease,
  assertProjectSessionsClosed,
  type AllowSessionLease,
} from './sessionLease.ts';
import { isMissing, safePath } from './files.ts';
import { stableId } from './validation.ts';

async function moveToTrash(path: string, trash: (path: string) => Promise<void>) {
  await trash(path);
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error(t('error.deleteAgentData.trashItemStillExists'));
}

/** Resolve only the selected agent's trusted folders; also used before stopping its idle Pi. */
export async function resolveAgentDataDeletion(
  store: StudioStore,
  request: DeleteAgentDataRequest,
  allowIdleLease?: AllowSessionLease,
) {
  if (!request || request.folder !== store.folder)
    throw new Error(t('registerTeamHandlers.studioFolderChanged'));
  if (!['dialogue', 'files', 'all'].includes(request.target))
    throw new Error(t('error.deleteAgentData.chooseWhatToDeleteDialogue'));
  const project = store.projects.list().find((item) => item.id === stableId(request.projectId));
  const agent = project?.agents.find((item) => item.profile.id === stableId(request.agentId));
  if (!project || !agent)
    throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
  const root = await store.projects.directory(project.id);
  const directory = agentRuntimeDirectory(agent);
  if (project.workspaceMode === 'shared' && request.target !== 'dialogue')
    await assertProjectSessionsClosed(project, root, allowIdleLease);
  const paths = [
    ...(request.target === 'dialogue'
      ? []
      : project.workspaceMode === 'shared'
        ? (await readdir(root)).filter(isSharedTaskPath)
        : [agent.outputPath]),
    ...(request.target !== 'files' ? [agentSessionDirectory(agent)] : []),
  ];
  // Validate both destinations before moving either; never follow a symlink.
  for (const path of paths) {
    const absolute = await safePath(root, path, true);
    try {
      const info = await lstat(absolute);
      if (
        info.isSymbolicLink() ||
        (!info.isDirectory() && !(project.workspaceMode === 'shared' && info.isFile()))
      )
        throw new Error(t('error.deleteAgentData.expectedAnOutputFolderOr'));
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
  allowIdleLease?: AllowSessionLease,
) {
  await resolveAgentDataDeletion(store, request, allowIdleLease);
  if (request.target !== 'files')
    await store.projects.prepareAgentSessions(request.projectId, request.agentId);
  const { project, agent, root, directory, paths } = await resolveAgentDataDeletion(
    store,
    request,
    allowIdleLease,
  );
  if (request.target !== 'files') {
    if (await hasLiveSessionLease(await safePath(root, directory)))
      throw new Error(t('error.deleteAgentData.theDialogueIsStillOpen'));
  }
  for (const path of paths) {
    const absolute = await safePath(root, path, true);
    // Shared cleanup trashes only task entries, never the project root or Studio service state.
    if (project.workspaceMode === 'shared' && isSharedTaskPath(path)) {
      await moveToTrash(absolute, trash);
      continue;
    }
    let entries: string[];
    try {
      entries = await readdir(absolute);
    } catch (error) {
      if (!isMissing(error)) throw error;
      entries = [];
    }
    if (entries.length) await moveToTrash(absolute, trash);
    await mkdir(await safePath(root, path, true), { recursive: true });
  }
  if (request.target !== 'dialogue') store.projects.clearOutputs(project.id, agent.profile.id);
  return request.target === 'files'
    ? store.projects.updateRuntime(project.id, agent.profile.id, 'idle')
    : store.projects.updateRuntime(project.id, agent.profile.id, 'idle', null);
}
