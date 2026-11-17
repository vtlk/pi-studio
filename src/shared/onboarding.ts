import type { Agent } from './studio.ts';
import type { AgentTeam } from './agentTeams.ts';
import type { Connection } from './connections.ts';
import type { Resource } from './resources.ts';
import type { TeamImportReport } from './teamPackage.ts';
import { validateAgentModel } from './modelConfiguration.ts';

export const completedTaskLifetime = 2 * 60 * 60 * 1000;
export interface OnboardingTask {
  id: string;
  kind: 'connection' | 'agent-model' | 'mcp-auth' | 'mcp-check';
  name: string;
  complete: boolean;
  agentId?: string;
  resourceId?: string;
  teamIds?: string[];
}
export interface OnboardingTaskRecord {
  id: string;
  completedAt?: number;
}

/** Current settings determine readiness. Import-time issue strings are never completion flags. */
export function onboardingTasks(
  agents: readonly Agent[],
  teams: readonly AgentTeam[],
  connections: readonly Connection[],
  resources: readonly Resource[],
  reports: readonly TeamImportReport[],
): OnboardingTask[] {
  const tasks: OnboardingTask[] = [
    {
      id: 'connection',
      kind: 'connection',
      name: '',
      complete: connections.length > 0,
    },
  ];
  for (const agent of agents)
    tasks.push({
      id: `agent:${agent.id}`,
      kind: 'agent-model',
      name: agent.name,
      agentId: agent.id,
      complete: validateAgentModel(agent.model, connections).ok,
    });
  const mcps = new Map<string, OnboardingTask>();
  for (const report of reports) {
    const team = teams.find((team) => team.id === report.teamId);
    if (!team) continue;
    for (const mcp of report.mcps ?? []) {
      if (
        !team.agentIds.some((id) =>
          agents.some(
            (agent) =>
              agent.id === id &&
              agent.mcps.includes(mcp.resourceId) &&
              agent.capabilitySettings?.[`mcps:${mcp.resourceId}`]?.enabled !== false,
          ),
        )
      )
        continue;
      const previous = mcps.get(mcp.resourceId);
      if (previous) {
        if (!previous.teamIds!.includes(team.id)) previous.teamIds!.push(team.id);
        continue;
      }
      const resource = resources.find(
        (resource) => resource.id === mcp.resourceId && resource.kind === 'mcps',
      );
      // A successful native check is evidence. Merely having a key or importing a flag is not.
      mcps.set(mcp.resourceId, {
        id: `mcp:${mcp.resourceId}`,
        kind:
          mcp.authorization.required === 'yes' || resource?.check?.status === 'needs_auth'
            ? 'mcp-auth'
            : 'mcp-check',
        name: resource?.name ?? mcp.resourceId,
        resourceId: mcp.resourceId,
        teamIds: [team.id],
        complete: resource?.check?.status === 'available',
      });
    }
  }
  return [...tasks, ...mcps.values()];
}

/** Only observed pending → ready transitions get a completion timestamp. Pending tasks never age out. */
export function reconcileOnboarding(
  previous: readonly OnboardingTaskRecord[],
  tasks: readonly OnboardingTask[],
  now: number,
): OnboardingTaskRecord[] {
  const records = new Map(previous.map((record) => [record.id, record]));
  return tasks.flatMap((task) => {
    if (!task.complete) return [{ id: task.id }];
    const old = records.get(task.id);
    if (!old) return [];
    const completedAt = old.completedAt ?? now;
    return now - completedAt < completedTaskLifetime ? [{ id: task.id, completedAt }] : [];
  });
}

export function parseOnboardingRecords(value: unknown): OnboardingTaskRecord[] {
  if (!Array.isArray(value) || value.length > 10000) return [];
  const ids = new Set<string>();
  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      entry.id.length > 500 ||
      ids.has(entry.id) ||
      (entry.completedAt !== undefined &&
        (!Number.isFinite(entry.completedAt) || entry.completedAt < 0))
    )
      return [];
    ids.add(entry.id);
    return [
      {
        id: entry.id,
        ...(entry.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
      },
    ];
  });
}
