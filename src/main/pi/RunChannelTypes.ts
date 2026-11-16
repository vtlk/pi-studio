import type { PreparedRun } from './ContextBuilder.ts';
export interface SessionEnvelope {
  teamAccess?: boolean;
  teamDelivery?: PreparedRun['teamDelivery'];
  terminalTitle?: string;
  modelAuth?: PreparedRun['modelAuth'];
  record: PreparedRun['record'];
  instructions: string;
  resources: PreparedRun['resources'];
  sessionPath?: string;
  fork?: boolean;
  firstMessage?: string;
  serviceAgent?: boolean;
}
export interface ChannelEvent {
  type: string;
  messageId?: string;
  entryId?: string;
  pid?: number;
  terminalIdentity?: import('../../shared/runtime.ts').TerminalIdentity;
  sessionId?: string;
  sessionFile?: string;
  outcome?: string;
  failure?: unknown;
  openingIssue?: unknown;
  message?: string;
  executableExtensions?: boolean;
  usage?: unknown;
}
export interface SessionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface SessionMcpResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string })[];
  isError?: boolean;
}
export interface SessionMcpGroup {
  name: string;
  tools: readonly SessionTool[];
  call: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<SessionMcpResult>;
}
