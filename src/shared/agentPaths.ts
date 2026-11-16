import { t } from './i18n/index.ts';
import { folderSlug } from './folderSlug.ts';

/** Identity stays in profile.id; this directory is the stable, readable project-local location. */
export function agentDirectory(outputPath: string) {
  if (!/^agents\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/output$/.test(outputPath))
    throw new Error(t('error.agentPaths.invalidAgentOutputPath'));
  return outputPath.slice(0, -'/output'.length);
}

export function agentFolderSlug(name: string) {
  return folderSlug(name, 'agent');
}

/** Shared work happens directly in the project root (an empty relative prefix). */
export function projectAgentOutputPath(
  project: Pick<import('./project').WorkspaceProject, 'workspaceMode'>,
  agent: Pick<import('./project').ProjectAgent, 'outputPath'>,
) {
  return project.workspaceMode === 'shared' ? '' : agent.outputPath;
}

export function agentRuntimeDirectory(
  agent: Pick<import('./project').ProjectAgent, 'outputPath' | 'runtimePath'>,
) {
  return agent.runtimePath ?? agentDirectory(agent.outputPath);
}

/** Studio metadata and legacy private agent folders are never shared deliverables. */
export function isSharedTaskPath(path: string) {
  const parts = path.split('/');
  return (
    !!path &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    parts.every((part) => !!part && part !== '.' && part !== '..') &&
    !parts[0].startsWith('.') &&
    !['agents', 'project.json'].includes(parts[0].toLowerCase())
  );
}

export function agentSessionDirectory(agent: Pick<import('./project').ProjectAgent, 'profile'>) {
  return `.pistudio/sessions/${agent.profile.id}`;
}

export function parseAgentStoragePaths(agentId: string, outputPath: unknown, runtimePath: unknown) {
  if (typeof outputPath !== 'string') throw new Error(t('error.agentPaths.invalidAgentOutputPath'));
  agentDirectory(outputPath);
  if (runtimePath !== undefined && runtimePath !== `.pistudio/agents/${agentId}`)
    throw new Error(t('error.agentPaths.invalidAgentServiceFolder'));
  return {
    outputPath,
    ...(runtimePath === undefined ? {} : { runtimePath: runtimePath as string }),
  };
}

export function isAgentSessionPath(agent: import('./project').ProjectAgent, path: string) {
  return (
    [`${agentDirectory(agent.outputPath)}/sessions/`, `${agentSessionDirectory(agent)}/`].some(
      (prefix) => path.startsWith(prefix),
    ) &&
    !path.includes('..') &&
    path.endsWith('.jsonl')
  );
}
