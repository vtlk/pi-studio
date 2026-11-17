import type { Agent } from '../../shared/studio.ts';
import type { AgentTeam } from '../../shared/agentTeams.ts';
import type { Connection, ImageConnectionStatus } from '../../shared/connections.ts';
import type { Resource } from '../../shared/resources.ts';
import type { TeamImportReport } from '../../shared/teamPackage.ts';
import type { ComputerState } from '../../shared/computer.ts';
import type { BrowserState } from '../../shared/browser.ts';
import {
  importedMcpScopes,
  type OnboardingReadiness as Snapshot,
  type ConnectionReadiness,
  type McpReadiness,
} from '../../shared/onboardingReadiness.ts';
import { browserMcp, computerMcp, builtinResource } from '../../shared/builtinResources.ts';
import { ReadinessChecks } from './ReadinessChecks.ts';

export interface OnboardingScope {
  folder: string;
  agents: Agent[];
  teams: AgentTeam[];
  connections: Connection[];
  resources: Resource[];
  reports: TeamImportReport[];
  imageTool?: { connectionId?: string; modelId?: string };
}
interface Dependencies {
  scope(folder: string): Promise<OnboardingScope>;
  connection(folder: string, id: string): Promise<ConnectionReadiness>;
  probeMcp(folder: string, id: string): Promise<{ revision: string; missing: boolean }>;
  checkMcp(folder: string, id: string): Promise<McpReadiness>;
  computer(): Promise<ComputerState>;
  browser(): Promise<BrowserState>;
  imageRevision(folder: string, id: string): Promise<string>;
  imageStatus(folder: string, id: string): Promise<ImageConnectionStatus>;
  checkImages(folder: string, id: string): Promise<ImageConnectionStatus>;
  terminal(): Promise<boolean>;
  terminalRequired?: boolean;
  git(): Promise<boolean>;
  windows: boolean;
  runtimeReady?: () => boolean;
  run?<T>(action: () => Promise<T>): Promise<T>;
  observeTeam?: (folder: string, packageId: string, ready: boolean) => Promise<void>;
}
/** Evaluating tasks never launches a dialogue, opens OAuth or requests OS permissions. */
export class OnboardingReadiness {
  private readonly dependencies: Dependencies;
  private readonly checks: ReadinessChecks;
  private observations = new Map<string, boolean>();
  constructor(dependencies: Dependencies, checks = new ReadinessChecks()) {
    this.dependencies = dependencies;
    this.checks = checks;
  }
  async read(folder: string, force = false): Promise<Snapshot> {
    const scope = await this.dependencies.scope(folder);
    const keys = new Set<string>();
    const read = <T>(
      id: string,
      signature: string,
      check: () => Promise<T>,
      fallback: T,
      ttl = 10000,
    ) => {
      const key = `${folder}\0${id}`;
      keys.add(key);
      return this.checks.read(
        key,
        signature,
        () => (this.dependencies.run ? this.dependencies.run(check) : check()),
        fallback,
        ttl,
        force,
      );
    };
    const result: Snapshot = {
      folder,
      terminal: 'ready',
      ...(this.dependencies.terminalRequired === false ? { terminalRequired: false } : {}),
      gitBash: this.dependencies.windows,
      connections: {},
      mcps: {},
    };
    if (this.dependencies.runtimeReady && !this.dependencies.runtimeReady()) {
      this.checks.retain(keys);
      for (const connection of scope.connections)
        if (connection.purpose !== 'images') result.connections[connection.id] = 'checking';
      return result;
    }
    if (this.dependencies.windows && this.dependencies.terminalRequired !== false)
      result.terminal = read(
        'terminal',
        '',
        async () =>
          (await this.dependencies.terminal()) ? ('ready' as const) : ('missing' as const),
        'checking',
      );
    result.git = read(
      'git',
      '',
      async () => ((await this.dependencies.git()) ? ('ready' as const) : ('missing' as const)),
      'checking',
    );
    for (const connection of scope.connections) {
      if (connection.purpose === 'images') continue;
      result.connections[connection.id] = read<ConnectionReadiness>(
        `connection:${connection.id}`,
        JSON.stringify(connection),
        async () => {
          try {
            return await this.dependencies.connection(folder, connection.id);
          } catch {
            return 'unavailable';
          }
        },
        'checking',
      );
    }
    const mcps = importedMcpScopes(scope.agents, scope.teams, scope.reports);
    for (const { resourceId } of mcps) {
      if (resourceId === computerMcp.id) {
        result.computer = read<ComputerState | undefined>(
          'computer',
          '',
          () => this.dependencies.computer(),
          undefined,
          this.dependencies.windows ? 10000 : 2000,
        );
      } else if (resourceId === browserMcp.id) {
        result.browser = read<BrowserState | undefined>(
          'browser',
          '',
          () => this.dependencies.browser(),
          undefined,
          2000,
        );
      } else if (!builtinResource(resourceId)) {
        let probe: { revision: string; missing: boolean };
        try {
          probe = await this.dependencies.probeMcp(folder, resourceId);
        } catch {
          result.mcps[resourceId] = 'unavailable';
          continue;
        }
        if (probe.missing) result.mcps[resourceId] = 'missing';
        else
          result.mcps[resourceId] = read<McpReadiness>(
            `mcp:${resourceId}`,
            probe.revision,
            async () => {
              try {
                return await this.dependencies.checkMcp(folder, resourceId);
              } catch {
                return 'unavailable';
              }
            },
            'checking',
            30000,
          );
      }
    }
    const imageTool = scope.imageTool;
    const needsImages =
      scope.reports.some(
        (report) => report.requiresImages && scope.teams.some((team) => team.id === report.teamId),
      ) ||
      (scope.reports.length > 0 && !!(imageTool?.connectionId || imageTool?.modelId));
    if (needsImages) {
      const connectionId = imageTool?.connectionId,
        modelId = imageTool?.modelId;
      result.images = 'not_ready';
      if (
        connectionId &&
        modelId &&
        scope.connections.some(
          (connection) => connection.id === connectionId && connection.purpose === 'images',
        )
      ) {
        try {
          const revision = await this.dependencies.imageRevision(folder, connectionId);
          const stored = await this.dependencies.imageStatus(folder, connectionId);
          if (stored.keyStored)
            result.images = read<NonNullable<Snapshot['images']>>(
              'images',
              JSON.stringify([connectionId, modelId, revision]),
              async () => {
                try {
                  const status = await this.dependencies.checkImages(folder, connectionId);
                  return status.authentication === 'ready' && status.modelIds.includes(modelId)
                    ? 'ready'
                    : 'not_ready';
                } catch {
                  return 'unavailable';
                }
              },
              'checking',
              30000,
            );
        } catch {
          result.images = 'unavailable';
        }
      }
    }
    const observations = new Set<string>();
    for (const report of scope.reports) {
      const external = mcps.filter(
        (mcp) => mcp.teamIds.includes(report.teamId) && !builtinResource(mcp.resourceId),
      );
      if (!external.length) continue;
      const key = `${folder}\0${report.id}`;
      observations.add(key);
      const statuses = external.map((mcp) => result.mcps[mcp.resourceId]);
      if (statuses.some((status) => !status || status === 'checking')) continue;
      const ready = statuses.every((status) => status === 'available');
      if (this.observations.get(key) !== ready) {
        await this.dependencies.observeTeam?.(folder, report.id, ready);
        this.observations.set(key, ready);
      }
    }
    for (const key of this.observations.keys())
      if (!observations.has(key)) this.observations.delete(key);
    this.checks.retain(keys);
    return result;
  }
  close() {
    this.checks.close();
    this.observations.clear();
  }
}
