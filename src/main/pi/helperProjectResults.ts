import { lstat } from 'node:fs/promises';
import { t } from '../../shared/i18n/index.ts';
import { isSharedTaskPath, projectAgentOutputPath } from '../../shared/agentPaths.ts';
import type { ProjectAgent, WorkspaceProject } from '../../shared/project.ts';
import type { StudioStore, StudioService } from '../storage/StudioStore.ts';
import { isMissing, safePath } from '../storage/files.ts';
import { text } from '../storage/validationFields.ts';
import { assertSetupInspectionScope } from './administrationScope.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { catalogPage } from './catalogReads.ts';
import { listProjectFiles, readProjectFile } from './projectFiles.ts';
import { isAgentResultPath, matchesSharedResult, safeSharedResults } from './sharedAgentResults.ts';

export const helperProjectToolNames = [
  'list_projects',
  'list_project_agents',
  'list_agent_results',
  'read_agent_result',
];
const normalized = (value: string) => value.trim().normalize('NFC').toLowerCase();

function select<T>(
  items: T[],
  value: unknown,
  id: (item: T) => string,
  names: (item: T) => string[],
  kind: 'project' | 'agent',
) {
  const key = text(value, 500).trim();
  if (!key) throw Error(t('HelperInspection.invalid'));
  const exact = items.find((item) => id(item) === key);
  if (exact) return exact;
  const named = items.filter((item) =>
    names(item).some((name) => normalized(name) === normalized(key)),
  );
  if (named.length === 1) return named[0];
  throw Error(
    t(
      named.length
        ? 'HelperInspection.ambiguous'
        : kind === 'project'
          ? 'HelperInspection.projectMissing'
          : 'HelperInspection.agentMissing',
    ),
  );
}

const projectNames = (item: WorkspaceProject) => [item.name, item.folderName ?? ''];
const agentNames = (item: ProjectAgent) => [item.profile.name];
const compactProject = ({ id, name, folderName, workspaceMode, createdAt }: WorkspaceProject) => ({
  id,
  name,
  folderName,
  workspaceMode: workspaceMode ?? 'per-agent',
  createdAt,
});

function projectAgent(store: StudioStore, args: Record<string, unknown>) {
  const project = select(
    store.projects.list(),
    args.project,
    (item) => item.id,
    projectNames,
    'project',
  );
  const agent = select(
    [...project.agents, ...(project.archivedAgents ?? []).map(({ agent }) => agent)],
    args.agent,
    (item) => item.profile.id,
    agentNames,
    'agent',
  );
  return { project, agent, outputPath: projectAgentOutputPath(project, agent) };
}

export async function helperProjectResults(
  service: StudioService,
  run: PreparedRun,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const scoped = <T>(load: (store: StudioStore) => T) =>
    service.serialize(async () => {
      signal?.throwIfAborted();
      const store = await service.load();
      assertSetupInspectionScope(store, run);
      return load(store);
    });
  if (name === 'list_projects')
    return scoped((store) => {
      const query = normalized(text(args.query ?? '', 500));
      const rows = store.projects
        .list()
        .filter((item) =>
          [item.id, ...projectNames(item)].some((key) => normalized(key).includes(query)),
        )
        .map(compactProject);
      return catalogPage(name, rows, args);
    });
  if (name === 'list_project_agents')
    return scoped((store) => {
      const project = select(
        store.projects.list(),
        args.project,
        (item) => item.id,
        projectNames,
        'project',
      );
      const rows = [
        ...project.agents.map(({ profile }) => ({
          id: profile.id,
          name: profile.name,
          enabled: profile.enabled,
          archived: false,
        })),
        ...(project.archivedAgents ?? []).map(({ agent: { profile } }) => ({
          id: profile.id,
          name: profile.name,
          enabled: profile.enabled,
          archived: true,
        })),
      ];
      return catalogPage(name, rows, args, { project: compactProject(project) });
    });
  const initial = await scoped((store) => ({ store, ...projectAgent(store, args) }));
  const { store, project, agent, outputPath } = initial;
  const projectRoot = await store.projects.directory(project.id);
  const root = outputPath ? await safePath(projectRoot, outputPath) : projectRoot;
  const identity = await lstat(root);
  if (!identity.isDirectory()) throw Error(t('HelperInspection.resultMissing'));
  const path = text(args.path ?? '', 1000);
  const reading = name === 'read_agent_result';
  if (
    (reading || (path && path !== '.')) &&
    (!isAgentResultPath(path) || (!outputPath && !isSharedTaskPath(path)))
  )
    throw Error(t('HelperInspection.resultMissing'));
  const shared = outputPath
    ? undefined
    : await safeSharedResults(projectRoot, project.id, agent.profile.id);
  const target = { project: project.id, agent: agent.profile.id };
  let result: object;
  if (reading) {
    const maxBytes = args.max_bytes ?? 2048;
    if (
      typeof maxBytes !== 'number' ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 4 ||
      maxBytes > 2048 ||
      (typeof args.offset === 'number' &&
        args.offset > 0 &&
        (typeof args.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.fingerprint)))
    )
      throw Error(t('HelperInspection.invalid'));
    const declared = shared?.outputs.find((file) => file.path === path);
    if (!outputPath && !declared) throw Error(t('HelperInspection.resultMissing'));
    const file = await readProjectFile(
      root,
      {
        path,
        offset: args.offset,
        maxBytes,
        encoding: args.encoding,
        fingerprint: args.fingerprint,
      },
      declared && shared
        ? (info) => {
            if (!matchesSharedResult(info, declared.size, shared.completedAt))
              throw Error(t('HelperInspection.resultChanged'));
          }
        : undefined,
    );
    result = { ...target, ...file };
  } else {
    const rows: object[] = [];
    if (outputPath) {
      const listed = await listProjectFiles(
        root,
        { path, limit: 10000 },
        true,
        isAgentResultPath,
        10000,
      );
      rows.push(
        ...listed.entries
          .filter((item) => item.readable)
          .map(({ path, kind, size }) => ({ path, kind, size })),
      );
      result = catalogPage(name, rows, { ...args, ...target }, target);
    } else {
      const prefix = path && path !== '.' ? `${path}/` : '';
      for (const file of shared?.outputs ?? []) {
        if (!file.path.startsWith(prefix)) continue;
        try {
          const info = await lstat(await safePath(root, file.path));
          if (info.isFile() && matchesSharedResult(info, file.size, shared!.completedAt))
            rows.push({ ...file, kind: 'file' });
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
      result = catalogPage(
        name,
        rows,
        { ...args, ...target },
        { ...target, attribution: 'latest_verified_completion', hasVerifiedCompletion: !!shared },
      );
    }
  }
  const currentProjectRoot = await store.projects.directory(project.id);
  const currentRoot = outputPath
    ? await safePath(currentProjectRoot, outputPath)
    : currentProjectRoot;
  const after = await lstat(currentRoot);
  await scoped((fresh) => {
    if (fresh !== store) throw Error(t('SettingsRead.changed'));
    const current = projectAgent(fresh, target);
    if (
      outputPath !== current.outputPath ||
      project.folderName !== current.project.folderName ||
      root !== currentRoot ||
      after.dev !== identity.dev ||
      after.ino !== identity.ino
    )
      throw Error(t('SettingsRead.changed'));
  });
  return result;
}
