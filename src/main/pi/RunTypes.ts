import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { AgentRunStatus, SessionBinding, WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { validateCompletedOutputs } from './completeStage.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { SessionTool } from './RunChannel.ts';
import type { RunFailure } from '../../shared/runFailure.ts';

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
  activateTerminal?: () => Promise<void>;
  headless?: boolean;
  beforeRequest?: (run: PreparedRun) => Promise<void>;
  tools?: readonly SessionTool[] | ((run: PreparedRun) => readonly SessionTool[]);
  closed?: (run: PreparedRun) => void;
  capabilities?: (run: PreparedRun, executableExtensions: boolean) => void;
  activityChanged?: (run: PreparedRun, working: boolean) => void;
  tool?: (run: PreparedRun, name: string, args: Record<string, unknown>) => Promise<unknown>;
  serviceAgent?: boolean;
  failureChanged?: (run: PreparedRun, failure?: RunFailure) => void;
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
  heartbeat: number;
  ready: (result: LaunchAgentResult) => void;
  fail: (error: Error) => void;
}
