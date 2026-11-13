import type { LaunchAgentRequest, LaunchAgentResult } from '../../shared/runtime.ts';
import type { AgentRunStatus, SessionBinding, WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { validateCompletedOutputs } from './completeStage.ts';
import type { openSessionTerminal } from './terminal.ts';

export interface RunDependencies {
  bootstraps: string;
  bridge: string;
  prepare: (request: LaunchAgentRequest) => Promise<{ run: PreparedRun; piPath: string }>;
  update: (
    run: PreparedRun,
    status: AgentRunStatus,
    session?: SessionBinding,
  ) => Promise<WorkspaceProject>;
  read: (run: PreparedRun) => Promise<WorkspaceProject>;
  openTerminal?: typeof openSessionTerminal;
  headless?: boolean;
  beforeRequest?: (run: PreparedRun) => Promise<void>;
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
  sequence: number;
  notifiedSequence?: number;
  userMessage?: string;
  completion?: Awaited<ReturnType<typeof validateCompletedOutputs>>;
  blocked: boolean;
  bound?: SessionBinding;
  heartbeat: number;
  ready: (result: LaunchAgentResult) => void;
  fail: (error: Error) => void;
}
