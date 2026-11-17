import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { AgentRunStatus, SessionBinding, WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { validateCompletedOutputs } from './completeStage.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { SessionTool, SessionMcpGroup, ChannelEvent } from './RunChannel.ts';
import type { TerminalCloseDetail, RunFailure } from '../../shared/runFailure.ts';

export interface RunDependencies {
  bootstraps: string;
  bridge: string;
  prepare: (request: LaunchAgentRequest) => Promise<{ run: PreparedRun; piPath: string }>;
  update: (
    run: PreparedRun,
    status: AgentRunStatus,
    session?: SessionBinding,
    failure?: RunFailure,
  ) => Promise<WorkspaceProject>;
  read: (run: PreparedRun) => Promise<WorkspaceProject>;
  openTerminal?: typeof openSessionTerminal;
  activateTerminal?: (pid: number, title?: string) => Promise<void>;
  headless?: boolean;
  beforeAutomaticClose?: (run: PreparedRun) => void | Promise<void>;
  captureTerminal?: typeof import('./automaticClose.ts').captureOwnedTab;
  beforeRequest?: (run: PreparedRun) => Promise<void>;
  tools?: readonly SessionTool[] | ((run: PreparedRun) => readonly SessionTool[]);
  mcpGroups?: (run: PreparedRun) => readonly SessionMcpGroup[];
  closed?: (run: PreparedRun) => void;
  capabilities?: (run: PreparedRun, executableExtensions: boolean) => void;
  runtimeCapabilities?: (run: PreparedRun) => Record<string, unknown>;
  activityChanged?: (run: PreparedRun, working: boolean) => void;
  accounting?: (run: PreparedRun, sample: unknown) => Promise<void>;
  accountingLost?: (run: PreparedRun) => Promise<void>;
  tool?: (
    run: PreparedRun,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  observed?: (run: PreparedRun, event: ChannelEvent) => Promise<void>;
  serviceAgent?: boolean;
  failureChanged?: (
    run: PreparedRun,
    failure?: RunFailure,
    terminalDetail?: TerminalCloseDetail,
  ) => void;
  completed?: (
    run: PreparedRun,
    outputs: Awaited<ReturnType<typeof validateCompletedOutputs>>,
    message: string,
  ) => Promise<void>;
}
export interface LiveRun {
  run: PreparedRun;
  request: LaunchAgentRequest;
  pid?: number;
  terminalIdentity?: import('../../shared/runtime.ts').TerminalIdentity;
  stop?: () => void;
  status: AgentRunStatus;
  failure?: RunFailure;
  sequence: number;
  notifiedSequence?: number;
  chain?: symbol;
  continueAfterSequence?: number;
  automaticCheck?: () => void;
  userMessage?: string;
  completion?: Awaited<ReturnType<typeof validateCompletedOutputs>>;
  blocked: boolean;
  bound?: SessionBinding;
  opened?: boolean;
  autoCloseSequence?: number;
  heartbeat: number;
  ready: (result: LaunchAgentResult) => void;
  fail: (error: Error) => void;
}

export function runKey(request: Pick<LaunchAgentRequest, 'projectId' | 'agentId'>) {
  return `${request.projectId}/${request.agentId}`;
}
export function hasConnectedRun(live: Iterable<LiveRun>, alive: (pid: number) => boolean) {
  return [...live].some((run) => run.pid && alive(run.pid) && Date.now() - run.heartbeat < 20000);
}

export class ContinuationCancelled extends Error {}
export interface Continuation {
  token: symbol;
  check: () => void;
}
