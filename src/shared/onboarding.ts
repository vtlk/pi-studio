import type { Agent } from './studio.ts';
import type { AgentTeam } from './agentTeams.ts';
import type { Connection } from './connections.ts';
import type { Resource } from './resources.ts';
import type { TeamImportReport } from './teamPackage.ts';
import { validateAgentModel } from './modelConfiguration.ts';
import { importedMcpScopes, type OnboardingReadiness } from './onboardingReadiness.ts';
import { builtinResource, browserMcp, computerMcp } from './builtinResources.ts';

export const completedTaskLifetime = 2 * 60 * 60 * 1000;
export interface OnboardingTask {
  id: string;
  kind:
    | 'connection'
    | 'connection-auth'
    | 'connection-check'
    | 'agent-model'
    | 'mcp-auth'
    | 'mcp-check'
    | 'mcp-install'
    | 'browser'
    | 'computer'
    | 'images'
    | 'terminal'
    | 'git'
    | 'create-team'
    | 'create-agent'
    | 'create-project'
    | 'readiness-check';
  name: string;
  complete: boolean;
  agentId?: string;
  connectionId?: string;
  retainCompleted?: boolean;
  checking?: boolean;
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
  options?: { readiness?: OnboardingReadiness; projectCount?: number; readinessError?: boolean },
): OnboardingTask[] {
  const tasks: OnboardingTask[] = [
    {
      id: 'connection',
      kind: 'connection',
      name: '',
      complete: connections.some((connection) => connection.purpose !== 'images'),
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
  for (const scope of importedMcpScopes(agents, teams, reports)) {
    const id = scope.resourceId;
    const builtin = builtinResource(id);
    const resource =
      resources.find((resource) => resource.id === id && resource.kind === 'mcps') ?? builtin;
    const status =
      options?.readiness?.mcps[id] ?? (options?.readiness ? 'checking' : resource?.check?.status);
    if (builtin && id !== browserMcp.id && id !== computerMcp.id) continue;
    const metadata = reports
      .flatMap((report) => report.mcps ?? [])
      .find((mcp) => mcp.resourceId === id);
    let kind: OnboardingTask['kind'] =
      status === 'missing'
        ? 'mcp-install'
        : status === 'needs_auth' ||
            (metadata?.authorization.required === 'yes' &&
              status !== 'unavailable' &&
              status !== 'disabled')
          ? 'mcp-auth'
          : 'mcp-check';
    let complete = status === 'available';
    if (id === computerMcp.id) {
      kind = 'computer';
      complete = options?.readiness?.computer?.phase === 'ready';
    }
    if (id === browserMcp.id) {
      kind = 'browser';
      complete = !!(
        options?.readiness?.browser?.headlessInstalled ||
        options?.readiness?.browser?.headedInstalled
      );
    }
    tasks.push({
      id: `mcp:${id}`,
      kind,
      name: resource?.name ?? metadata?.name ?? id,
      resourceId: id,
      teamIds: scope.teamIds,
      complete,
      checking:
        kind === 'computer'
          ? !options?.readiness?.computer
          : kind === 'browser'
            ? !options?.readiness?.browser
            : status === 'checking',
    });
  }
  if (options?.readiness) {
    for (const connection of connections.filter((connection) => connection.purpose !== 'images')) {
      const status = options.readiness.connections[connection.id];
      tasks.push({
        id: `connection:${connection.id}`,
        kind:
          status === 'checking' || status === 'unavailable' || !status
            ? 'connection-check'
            : 'connection-auth',
        name: connection.name,
        connectionId: connection.id,
        complete: status === 'ready',
        checking: !status || status === 'checking',
      });
    }
    tasks.unshift({
      id: 'terminal',
      kind: 'terminal',
      name: '',
      complete: options.readiness.terminal === 'ready',
      checking: options.readiness.terminal === 'checking',
    });
    if (options.readiness.git !== undefined)
      tasks.unshift({
        id: 'git',
        kind: 'git',
        name: '',
        complete: options.readiness.git === 'ready',
        checking: options.readiness.git === 'checking',
      });
    if (options.readiness.images !== undefined)
      tasks.push({
        id: 'images',
        kind: 'images',
        name: '',
        complete: options.readiness.images === 'ready',
        checking: options.readiness.images === 'checking',
      });
  }
  if (options?.projectCount !== undefined) {
    const ordinary = agents.filter((agent) => !('systemRole' in agent));
    tasks.push(
      {
        id: 'create-team',
        kind: 'create-team',
        name: '',
        complete: teams.length > 0,
        retainCompleted: false,
      },
      {
        id: 'create-agent',
        kind: 'create-agent',
        name: '',
        complete: ordinary.length > 0,
        retainCompleted: false,
      },
      {
        id: 'create-project',
        kind: 'create-project',
        name: '',
        complete: options.projectCount > 0,
        retainCompleted: false,
      },
    );
  }
  if (options?.readinessError)
    tasks.unshift({ id: 'readiness-check', kind: 'readiness-check', name: '', complete: false });
  return tasks;
}

/** Only observed pending → ready transitions get a completion timestamp. Pending tasks never age out. */
export function reconcileOnboarding(
  previous: readonly OnboardingTaskRecord[],
  tasks: readonly OnboardingTask[],
  now: number,
): OnboardingTaskRecord[] {
  const records = new Map(previous.map((record) => [record.id, record]));
  return tasks.flatMap((task) => {
    if (!task.complete) {
      const old = records.get(task.id);
      return [task.checking && old ? old : { id: task.id }];
    }
    if (task.retainCompleted === false) return [];
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
