import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../../shared/studio.ts';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import type { RunContextRecord } from '../../shared/runtime.ts';
import type { Resource } from '../../shared/resources.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { resolveResources, type ResolvedResources } from './resources.ts';

export interface PreparedRun {
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
): Promise<PreparedRun> {
  const agent = project.agents.find((item) => item.profile.id === agentId);
  if (!agent) throw new Error('Агент отсутствует в снимке проекта.');
  if (!agent.profile.enabled) throw new Error('Агент выключен.');
  const current = constructor.find((item) => item.id === agentId);
  if (!current)
    throw new Error('Текущие инструкции агента удалены. Другой профиль не подставляется.');
  const model = agent.profile.model;
  if (!model?.provider || !model.id || !model.connectionId)
    throw new Error(
      'Выберите подключение и модель агента в конструкторе, затем явно перечитайте агента в проекте.',
    );
  const cwd = await safePath(projectRoot, `agents/${agentId}`);
  const output = await safePath(projectRoot, agent.outputPath);
  const sessionDirectory = await safePath(projectRoot, `agents/${agentId}/sessions`);
  const resources = await resolveResources(agent.profile, catalog);
  const record: RunContextRecord = {
    schemaVersion: 1,
    runId: randomUUID(),
    projectId: project.id,
    agentId,
    createdAt: Date.now(),
    cwd,
    output,
    sessionDirectory,
    previousOutputs: project.agents
      .slice(0, project.agents.indexOf(agent))
      .map((item) => ({ agentId: item.profile.id, path: join(projectRoot, item.outputPath) })),
    model: { provider: model.provider, id: model.id, reasoning: model.reasoning },
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
