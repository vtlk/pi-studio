import { t } from '../../shared/i18n/index.ts';
import { lstat, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import {
  agentDirectory,
  agentRuntimeDirectory,
  agentSessionDirectory,
} from '../../shared/agentPaths.ts';
import { hasLiveSessionLease } from './sessionLease.ts';
import { isMissing, safePath, atomicJson } from './files.ts';
import { projectDocument } from './validation.ts';
import { ensureProjectAgents } from './ensureProjectAgents.ts';

async function exists(path: string) {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Rename whole history directories, without parsing, copying or editing a single JSONL byte.
 * If interrupted after rename, the saved old binding is recovered on the next attempt.
 */
export async function migrateAgentSessions(
  root: string,
  agent: ProjectAgent,
): Promise<ProjectAgent> {
  const canonical = agentSessionDirectory(agent);
  const legacy = `${agentDirectory(agent.outputPath)}/sessions`;
  const source = await safePath(root, legacy, true);
  const target = await safePath(root, canonical, true);
  const oldExists = await exists(source);
  const oldBinding = agent.session?.path.startsWith(`${legacy}/`);
  if (!oldExists && !oldBinding) return agent;
  for (const directory of new Set([agentDirectory(agent.outputPath), agentRuntimeDirectory(agent)]))
    if (await hasLiveSessionLease(await safePath(root, directory, true)))
      throw new Error(t('error.migrateAgentSessions.closeThisAgentSPi'));
  if (oldExists) {
    if (await exists(target))
      throw new Error(t('error.migrateAgentSessions.twoAgentSessionFoldersWere'));
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }
  if (!oldBinding) return agent;
  const path = `${canonical}/${agent.session!.path.slice(legacy.length + 1)}`;
  await safePath(root, path);
  return { ...agent, session: { ...agent.session!, path } };
}

export async function migrateProjectSessions(
  root: string,
  project: WorkspaceProject,
  warn: (message: string) => void,
) {
  const migrate = async (agent: ProjectAgent) => {
    try {
      return await migrateAgentSessions(root, agent);
    } catch (error) {
      warn(error instanceof Error ? error.message : 'sessions migration deferred');
      return agent;
    }
  };
  const agents: ProjectAgent[] = [];
  for (const agent of project.agents) agents.push(await migrate(agent));
  const archivedAgents: WorkspaceProject['archivedAgents'] = project.archivedAgents
    ? []
    : undefined;
  for (const archived of project.archivedAgents ?? [])
    archivedAgents!.push({ ...archived, agent: await migrate(archived.agent) });
  if (
    !agents.some((agent, index) => agent !== project.agents[index]) &&
    !archivedAgents?.some((item, index) => item.agent !== project.archivedAgents![index].agent)
  )
    return project;
  const updated = { ...project, agents, ...(archivedAgents ? { archivedAgents } : {}) };
  await atomicJson(await safePath(root, 'project.json'), projectDocument(updated));
  return updated;
}

export async function prepareProjectAgentSessions(
  root: string,
  project: WorkspaceProject,
  agentId: string,
) {
  const selected = project.agents.find((agent) => agent.profile.id === agentId);
  if (!selected) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
  const runtimePath = `.pistudio/agents/${selected.profile.id}`;
  for (const directory of new Set([agentRuntimeDirectory(selected), runtimePath]))
    if (await hasLiveSessionLease(await safePath(root, directory, true)))
      throw new Error(t('error.migrateAgentSessions.theDialogueIsStillOpen'));
  const legacy = await migrateAgentSessions(root, selected);
  const migrated = legacy.runtimePath ? legacy : { ...legacy, runtimePath };
  const updated =
    migrated === selected
      ? project
      : {
          ...project,
          agents: project.agents.map((agent) => (agent === selected ? migrated : agent)),
        };
  await ensureProjectAgents(updated, root);
  return updated;
}
