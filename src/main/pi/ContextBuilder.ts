import { parseReasoning, type ThinkingLevel } from '../../shared/reasoning.ts';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../../shared/studio.ts';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import type { RunContextRecord } from '../../shared/runtime.ts';
import type { Resource } from '../../shared/resources.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { resolveResources, type ResolvedResources, type McpConfigResolver } from './resources.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import { hasModelConfiguration } from '../../shared/modelConfiguration.ts';
import { hasLibraryMcp, hasTeamMcp, optionalBuiltinMcps } from '../../shared/builtinResources.ts';

import type { ModelAuthScope } from './modelAuth.ts';

export interface PreparedRun {
  libraryAccess?: boolean;
  teamAccess?: boolean;
  teamDelivery?: import('../team-mcp/types.ts').TeamDelivery;
  libraryKind?: 'characters' | 'locations';
  modelAuth?: ModelAuthScope;
  requestSequence?: number;
  record: RunContextRecord;
  instructions: string;
  resources: ResolvedResources;
  project: WorkspaceProject;
  agent: ProjectAgent;
  projectRoot: string;
}
export async function buildRunContext(
  projectRoot: string,
  project: WorkspaceProject,
  agentId: string,
  constructor: Agent[],
  catalog: Resource[],
  materializeMcp?: McpConfigResolver,
  thinkingLevel?: ThinkingLevel,
): Promise<PreparedRun> {
  projectRoot = await realpath(projectRoot);
  const saved = project.agents.find((item) => item.profile.id === agentId);
  if (!saved) throw new Error('Агент отсутствует в снимке проекта.');
  if (!saved.profile.enabled) throw new Error('Агент выключен.');
  const current = constructor.find((item) => item.id === agentId);
  if (!current)
    throw new Error('Текущие инструкции агента удалены. Другой профиль не подставляется.');
  const model = current.model;
  if (!hasModelConfiguration(model))
    throw new Error('Выберите подключение, модель и уровень рассуждения агента в конструкторе.');
  // This app-owned capability is revoked from the current constructor on each explicit open.
  const libraryAccess = hasLibraryMcp(current);
  const teamAccess = hasTeamMcp(current);
  const optionalIds = optionalBuiltinMcps.map((item) => item.id);
  const enabledIds = optionalIds.filter(
    (id) =>
      current.mcps.includes(id) && current.capabilitySettings?.[`mcps:${id}`]?.enabled !== false,
  );
  const agent: ProjectAgent = {
    ...saved,
    profile: {
      ...saved.profile,
      model: structuredClone(model),
      mcps: [...saved.profile.mcps.filter((id) => !optionalIds.includes(id)), ...enabledIds],
      capabilitySettings: {
        ...saved.profile.capabilitySettings,
        ...Object.fromEntries(
          optionalIds.map((id) => [`mcps:${id}`, { enabled: enabledIds.includes(id) }]),
        ),
      },
    },
  };
  project = { ...project, agents: project.agents.map((item) => (item === saved ? agent : item)) };
  const agentFolder = agentDirectory(agent.outputPath);
  const cwd = await safePath(projectRoot, agentFolder);
  const output = await safePath(projectRoot, agent.outputPath);
  const sessionDirectory = await safePath(projectRoot, `${agentFolder}/sessions`);
  const resources = await resolveResources(agent.profile, catalog, materializeMcp);
  const record: RunContextRecord = {
    schemaVersion: 1,
    runId: randomUUID(),
    projectId: project.id,
    agentId,
    createdAt: Date.now(),
    projectRoot,
    cwd,
    output,
    sessionDirectory,
    previousOutputs: project.agents.slice(0, project.agents.indexOf(agent)).map((item) => ({
      agentId: item.profile.id,
      agentName: item.profile.name,
      path: join(projectRoot, item.outputPath),
    })),
    model: {
      connectionId: model.connectionId,
      provider: model.provider,
      id: model.id,
      reasoning: model.reasoning,
      thinkingLevel:
        thinkingLevel ??
        (parseReasoning(model.reasoning) === 'default'
          ? 'medium'
          : (parseReasoning(model.reasoning) as ThinkingLevel)),
    },
    resourceIds: {
      skills: resources.skills.map((item) => item.id),
      mcps: agent.profile.mcps.filter(
        (id) => agent.profile.capabilitySettings?.[`mcps:${id}`]?.enabled !== false,
      ),
      plugins: resources.plugins.map((item) => item.id),
    },
    instructionIds: current.instructions.filter((item) => item.enabled).map((item) => item.id),
  };
  const directory = await safePath(projectRoot, `.pistudio/context/${record.runId}`, true);
  await mkdir(directory, { recursive: true });
  await atomicJson(join(directory, 'context.json'), record);
  return {
    libraryAccess,
    teamAccess,
    record,
    instructions: [
      current.mainInstruction ?? '',
      ...current.instructions
        .filter((item) => item.enabled)
        .map((item) => `${item.name}\n${item.content}`),
    ]
      .filter(Boolean)
      .join('\n\n'),
    resources,
    project,
    agent,
    projectRoot,
  };
}
