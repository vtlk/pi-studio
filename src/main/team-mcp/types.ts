import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { AgentRunStatus } from '../../shared/project.ts';

export interface TeamDelivery {
  messageId: string;
  senderId: string;
  recipientId: string;
  lineage: string[];
}
export type TeamCaller = Pick<
  PreparedRun,
  'project' | 'projectRoot' | 'teamAccess' | 'teamDelivery'
> & {
  record: Pick<PreparedRun['record'], 'projectId' | 'agentId'>;
};
export interface TeamRuntime {
  run: PreparedRun;
  status: AgentRunStatus;
  blocked: boolean;
  sequence: number;
  opened: boolean;
  delivering: boolean;
}
export interface TeamHost {
  inspect(projectId: string, agentId: string): TeamRuntime | undefined;
  teamUnavailable(projectId: string, agentId: string): string | undefined;
  assertTeamDispatch(projectId: string, agentId: string, runId: string): void;
  launchTeamTask(
    projectId: string,
    agentId: string,
    text: string,
    delivery: TeamDelivery,
    beforeDispatch: (run: PreparedRun) => Promise<void>,
  ): Promise<unknown>;
}
export type MessageState =
  'queued' | 'dispatching' | 'received' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
export interface TeamMessage {
  version: 1;
  id: string;
  requestId: string;
  projectId: string;
  sourceTeamId: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  queueOrder?: number;
  updatedAt: number;
  state: MessageState;
  bodyHash: string;
  dispatchHash?: string;
  /** Only undelivered explicit task input, never profile or skill snapshots. */
  text?: string;
  lineage: string[];
  expectedSession?: { id: string; path: string };
  runId?: string;
  sessionId?: string;
  sessionPath?: string;
  entryId?: string;
  reason?: string;
}
export function publicMessage(message: TeamMessage, armed: boolean) {
  const {
    text: _text,
    bodyHash: _hash,
    dispatchHash: _dispatchHash,
    lineage: _lineage,
    expectedSession: _expected,
    ...safe
  } = message;
  return {
    ...safe,
    preview: message.text?.slice(0, 500),
    requiresExplicitResume: message.state === 'queued' && !armed,
  };
}
